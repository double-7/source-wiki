---
name: sw:ingest
description: "增量同步 wiki 与源码变更。检测变更、构建影响图、逐 target 处理"
argument-hint: "[change description | --auto]"
user-invocable: true
---

单会话自包含流程——增量同步源码变更到 wiki。

## 1. 前置步骤

读取 `${CLAUDE_PLUGIN_ROOT}/schemas/wiki-schema.md` 加载共享规则。

## 2. 参数解析

捕获 `$ARGUMENTS`，解析为上下文变量：

| 变量 | 来源 | 默认值 |
|------|------|--------|
| intent | `$ARGUMENTS` 去除 `--auto` 后的文本 | `""` |
| auto | `$ARGUMENTS` 是否包含 `--auto` | `false` |

intent 是纯文本，可能包含：
- 变更描述："新增了登录双 token 刷新机制"
- 文件引用："详细需求@docs/plan/xxxxx.md"
- 混合内容："重构了 auth 模块，详见@docs/design.md"

全部作为意图文本处理，LLM 自行识别和利用其中的信息。Skill 不做结构化拆分。

无参数时 intent 为空，退化为纯 diff 模式（现有行为）。

## 3. 状态判断

Glob `docs/wiki/wiki.*.json`：

| 状态 | 动作 |
|------|------|
| 有 wiki.ingest.json | 中断恢复（AskUserQuestion 三选项：恢复/保留重建/完全重来） |
| 有其他 wiki.*.json | 拒绝："另一个操作正在进行中。请先完成。" |
| 无临时文件 | 确认 docs/wiki/ 存在且有页面 → 继续变更检测；不存在 → 报错"请先运行 `/sw:init`" |

恢复时读取 wiki.ingest.json 的 pending/completed 状态，跳到处理步骤继续执行。

## 4. 变更检测

### 4.1. 锚点检测

按以下顺序获取 git diff 基准点：

```bash
git log -1 --format=%H -- docs/wiki/log.md
```

- 有返回值 → 使用该 commit hash，执行 `git diff <hash>`（diff 到工作区，含 staged + unstaged 变更）
- 无返回（log.md 未 commit 过）→ 执行 `git log -1 --format=%H`
  - 有 HEAD → 使用 HEAD hash，执行 `git diff <hash>`（diff 到工作区，含 staged + unstaged 变更）
  - 无返回（空仓库）→ 报告"wiki 刚初始化，尚无源码变更可同步"，正常退出
- 非 git 仓库 → 报错"ingest 要求项目使用 git"

### 4.2. 检测源码变化

```bash
git diff <hash> -- <source-dir> -- ':!docs/wiki/'
```

提取变更文件列表（相对项目根目录的路径）。无变更 → 提示"wiki 已是最新"，终止。

### 4.3. 影响分析

使用 `query-wiki.js` 进行结构化查询，分两级推导影响范围。

**direct（直接影响）**：对每个变更文件查询命中 feature

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/query-wiki.js --dir docs/wiki --type feature --field source --contains <changed-file>
```

命中 feature → 该 feature 是 direct target，reason 记录变更文件名。

**indirect（间接影响）**：从 direct target 向上推导关联页面

```bash
# direct target 所属 module
node ${CLAUDE_PLUGIN_ROOT}/scripts/query-wiki.js --dir docs/wiki --type module --field features --contains "[[features/<target-id>]]"

# module 涉及的 flow
node ${CLAUDE_PLUGIN_ROOT}/scripts/query-wiki.js --dir docs/wiki --type flow --field modules --contains "[[modules/<module-id>]]"
```

对每个 target 记录 `id`、`type`（direct/indirect）、`reason`。去重：已在 direct 中的 target 不重复加入 indirect。

**intent（意图推导）**：当 intent 非空时，从 intent 文本提取与 wiki 页面相关的关键词（模块名、feature 名、技术术语），对关键词搜索匹配页面：

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/query-wiki.js --dir docs/wiki --type feature --field title --contains <keyword>
node ${CLAUDE_PLUGIN_ROOT}/scripts/query-wiki.js --dir docs/wiki --type module --field title --contains <keyword>
node ${CLAUDE_PLUGIN_ROOT}/scripts/query-wiki.js --dir docs/wiki --type flow --field title --contains <keyword>
```

注意：`--contains` 是子串匹配（`auth` 会匹配 `authentication`、`authorization`），LLM 应过滤明显无关的匹配结果。

匹配的页面作为 intent target，reason 记录意图原文中的关键词。去重：已在 direct 或 indirect 中的 target 不重复加入 intent。intent target 置信度说明：diff 未直接命中，仅凭用户意图推导。

**新增文件处理**：变更文件无对应 feature 时，判断是否属于新 feature → 加入 direct targets；否则归入最近的已有 feature 的变更范围。

### 4.4. 创建 wiki.ingest.json

```json
{
  "anchor": "<commit-hash>",
  "intent": "新增了登录双 token 刷新机制",
  "mode": "interactive",
  "changedFiles": ["src/auth/LoginService.kt"],
  "pending": [
    {"id": "login", "type": "direct", "reason": "src/auth/LoginService.kt modified"},
    {"id": "auth-flow", "type": "indirect", "reason": "involves affected module auth"},
    {"id": "auth-module", "type": "intent", "reason": "intent mentions: 登录双 token 刷新机制"}
  ],
  "completed": []
}
```

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| anchor | string | 是 | git commit hash，diff 基准点 |
| intent | string | 否 | 用户意图（来自 $ARGUMENTS） |
| mode | string | 否 | `"interactive"`（默认）或 `"auto"` |
| changedFiles | string[] | 是 | 检测到的源码变更文件列表 |
| pending | target[] | 是 | 待处理目标 |
| completed | target[] | 是 | 已处理目标 |

**target 结构**：

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | feature 或 flow 页面名 |
| type | string | `"direct"`（source 匹配）、`"indirect"`（关系推导）或 `"intent"`（意图推导） |
| reason | string | 选中此目标的理由 |

**状态流转**：分析变更后写入 targets → 逐 target 处理，从 pending 移到 completed → 汇总后删除文件。

### 4.5. 检查点 — 用户确认

**交互模式**（auto 为 false）：AskUserQuestion 展示影响分析：

```
增量同步影响分析

用户意图：新增了登录双 token 刷新机制

变更文件：X 个文件（anchor: abc123 → working tree）

直接受影响（将更新）：
- features/login.md（src/auth/LoginService.kt 变更）

间接影响（将检查）：
- flows/auth-flow.md ← 涉及 auth 模块

意图推导（将参考）：
- modules/auth.md ← intent: 登录双 token 刷新机制

是否继续处理？
```

无 intent 时省略"用户意图"行和"意图推导"分组。

**非交互模式**（auto 为 true）：跳过确认，直接进入处理步骤。限制：indirect targets 不修改页面，仅记录 issue。

## 5. 逐 target 处理

对 wiki.ingest.json 中每个 pending target 顺序处理。

### 5.1. type == "direct"

源码文件变更命中 feature 的 source 字段。

1. 读取目标 feature wiki 页面，获取 frontmatter 的 `guidelines` 和 `issues`
2. Grep 模块内 export 签名和 import 依赖，获取源码 Tier 1 签名
3. 对比分析：
   - 有结构变化（新增/删除文件、新增/删除导出）→ 按 guidelines 修改页面内容
   - 新旧矛盾（描述与代码不一致）→ 有 guideline 按原则更新，无 guideline 基于源码更新
   - 无变化 → 跳过，不修改页面
   - intent 非空时参考 intent 理解变更意图；intent 与 diff 事实冲突时以 diff 为准
4. 修改页面时同步更新 frontmatter `updated` 为当前秒级 ISO 时间戳
5. 特殊情况：
   - 新增文件无法归属现有 feature → 读取 `${CLAUDE_PLUGIN_ROOT}/templates/feature.md` 创建新 feature 页面
   - 删除文件导致 feature 的 source 全部不存在 → 在该 feature 页面记录 issue：`[structural] source 全部不存在，建议删除此页面 — ingest 日期`。不自动删除（结构性变更属于修复边界的"只记录不修"，由 lint 或用户确认后处理）
6. Guidelines 提取（单页）：
   - 源码变更揭示了新的设计决策或架构约定 → 提取为 guideline（判断标准：变更体现了可复用的模式或约束）
   - intent 明确描述了设计决策 → 优先提取为 guideline
   - 源码变更使旧 guideline 失效 → 标注冲突，更新或移除
   - 与页面已有 guidelines 对比，去重合并
   - 写入页面 frontmatter
   - 注意：不是每次变更都产生 guideline，只有变更揭示了设计决策（而非事实细节）时才提取

### 5.2. type == "indirect"

跨模块关联影响（module/flow/architecture 等）。

1. 读取目标页面，获取 frontmatter 的 `guidelines` 和 `issues`
2. 读取 reason 中提到的变更模块相关源码（如 indirect 是因 module 下的 feature 变更）
3. 按修复边界决策处理：
   - **机械修正**（路径替换、事实修正、字段同步）→ 直接执行
   - **内容更新**（非机械性单页更新、跨引用修正）→ AskUserQuestion 确认后执行
   - **只记录不修**（跨页面一致性、全局视角判断、信息不足、结构性变更）→ 写 issues，留给 lint
4. 非交互模式下：不修改页面内容，仅记录 issue，格式：`[auto-skip] indirect target 未自动处理 — ingest 日期`
5. 修改页面时同步更新 frontmatter `updated`（非交互模式下跳过此步骤）
6. 跨页 guidelines 发现：
   - 间接影响揭示了跨页模式或约定（如多个模块都受同一变更影响）→ 记录 issue，格式：`[guideline] 模式描述 — ingest 日期`
   - intent 非空时 issue 描述更精确："因 [intent 摘要] 导致 [module] 受影响"
   - `[guideline]` 前缀标记此 issue 为 guideline 候选建议，供 lint 消费
   - Ingest 不做跨页 guidelines 提取（缺少全局上下文）

### 5.3. type == "intent"

意图推导的 target（diff 未直接命中）。

1. 读取目标页面，获取 frontmatter 的 `guidelines` 和 `issues`
2. 读取 intent 原文，结合 diff 中相关文件变更（如有），判断是否需要更新
3. 处理策略（保守）：
   - diff 有相关变更证据 → 按 direct 模式处理（等同 direct 置信）
   - diff 无直接证据但 intent 明确 → 仅记录 issue，格式：`[intent] intent 摘要 — ingest 日期`
   - intent 提到的文件/模块不存在 → 跳过
4. 非交互模式下：等同交互模式处理（intent target 有用户意图作为依据）
5. 修改页面时同步更新 frontmatter `updated`

### 5.4. 更新 wiki.ingest.json

每处理完一个 target：从 `pending` 移除该 target，追加到 `completed`。Edit wiki.ingest.json 保存进度，确保中断后可从断点恢复。

## 6. 汇总报告

### 6.1. 重建报告

按 type 分组输出：

```markdown
## 增量同步完成

用户意图：新增了登录双 token 刷新机制

### 直接受影响（已更新）
- features/login.md
  → 更新：状态枚举新增 CONNECTING

### 间接影响（已处理）
- flows/auth-flow.md ← 涉及 auth 模块
  → 基于 guideline 更新

### 意图推导（已处理）
- modules/auth.md（intent: "登录双 token 刷新机制"）
  → 记录 issue: [intent] 新增双 token 刷新机制 — ingest 2026-05-28
```

无 intent 时省略"用户意图"行和"意图推导"分组。跳过的 target 单独标注说明。

### 6.2. 清理

删除 `docs/wiki/wiki.ingest.json`。

### 6.3. 更新 index.md + 追加 log.md

- Edit `docs/wiki/index.md`，将 `updated` 更新为当前秒级 ISO 时间戳
- 追加变更日志到 `docs/wiki/log.md`，格式：

```markdown
## [2026-04-21] ingest | 增量同步

- 变更文件：src/auth/LoginService.kt, src/user/UserService.kt（anchor: abc123）
- 更新：features/login.md, modules/auth.md
- 关键发现：LoginService 新增双 token 刷新机制
```

### 6.4. 建议后续

- 人工审查更新的页面
- 运行 `/sw:lint` 进行健康检查
- 下次变更后继续使用 `/sw:ingest`
