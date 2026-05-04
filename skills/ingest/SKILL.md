---
name: sw:ingest
description: "增量同步 wiki 与源码变更。检测变更、构建影响图、逐 target 处理"
user-invocable: true
disable-model-invocation: true
---

单会话自包含流程——增量同步源码变更到 wiki。

## 前置步骤

读取 `${CLAUDE_PLUGIN_ROOT}/agents/wiki-maintainer.md` 加载共享规则。

## 状态判断

Glob `docs/wiki/wiki.*.json`：

| 状态 | 动作 |
|------|------|
| 有 wiki.ingest.json | 中断恢复（AskUserQuestion 三选项：恢复/保留重建/完全重来） |
| 有其他 wiki.*.json | 拒绝："另一个操作正在进行中。请先完成。" |
| 无临时文件 | 确认 docs/wiki/ 存在且有页面 → 继续 Detect；不存在 → 报错"请先运行 `/sw:init`" |

恢复时读取 wiki.ingest.json 的 pending/completed 状态，跳到处理阶段继续执行。

## Detect 阶段

### 1. 锚点检测

按以下顺序获取 git diff 基准点：

```bash
git log -1 --format=%H -- docs/wiki/log.md
```

- 有返回值 → 使用该 commit hash，执行 `git diff <hash>..HEAD`
- 无返回（log.md 未 commit 过）→ 执行 `git log -1 --format=%H`
  - 有 HEAD → 使用 HEAD hash，执行 `git diff <hash>`（diff 到工作区，含未暂存变更）
  - 无返回（空仓库）→ 报告"wiki 刚初始化，尚无源码变更可同步"，正常退出
- 非 git 仓库 → 报错"ingest 要求项目使用 git"

### 2. 检测源码变化

```bash
git diff <hash> -- <source-dir> -- ':!docs/wiki/'
```

提取变更文件列表（相对项目根目录的路径）。无变更 → 提示"wiki 已是最新"，终止。

### 3. 影响分析

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

**新增文件处理**：变更文件无对应 feature 时，判断是否属于新 feature → 加入 direct targets；否则归入最近的已有 feature 的变更范围。

### 4. 创建 wiki.ingest.json

Schema 引用 `docs/design.local.md` §4.6：

```json
{
  "anchor": "<commit-hash>",
  "changedFiles": ["src/auth/LoginService.kt"],
  "pending": [
    {"id": "login", "type": "direct", "reason": "src/auth/LoginService.kt modified"},
    {"id": "auth-flow", "type": "indirect", "reason": "involves affected module auth"}
  ],
  "completed": []
}
```

### 5. 检查点 -- 用户确认

AskUserQuestion 展示影响分析：

```
增量同步影响分析

变更文件：X 个文件（anchor: abc123 → HEAD）

直接受影响（将更新）：
- features/login.md（src/auth/LoginService.kt 变更）

间接影响（将检查）：
- flows/auth-flow.md ← 涉及 auth 模块

是否继续处理？
```

用户确认后进入处理阶段。

## 处理阶段

对 wiki.ingest.json 中每个 pending target 顺序处理。

### type == "direct"

源码文件变更命中 feature 的 source 字段。

1. 读取目标 feature wiki 页面，获取 frontmatter 的 `guidelines` 和 `issues`
2. Grep 模块内 export 签名和 import 依赖，获取源码 Tier 1 签名
3. 对比分析：
   - 有结构变化（新增/删除文件、新增/删除导出）→ 按 guidelines 修改页面内容
   - 新旧矛盾（描述与代码不一致）→ 有 guideline 按原则更新，无 guideline 基于源码更新
   - 无变化 → 跳过，不修改页面
4. 修改页面时同步更新 frontmatter `updated` 为当前秒级 ISO 时间戳
5. 特殊情况：
   - 新增文件无法归属现有 feature → 读取 `${CLAUDE_PLUGIN_ROOT}/templates/feature.md` 创建新 feature 页面
   - 删除文件导致 feature 的 source 全部不存在 → 删除该 feature 页面，更新所属 module 的 features 字段

### type == "indirect"

跨模块关联影响（module/flow/architecture 等）。

1. 读取目标页面，获取 frontmatter 的 `guidelines` 和 `issues`
2. 读取 reason 中提到的变更模块相关源码（如 indirect 是因 module 下的 feature 变更）
3. 按修复边界决策处理（wiki-maintainer.md 修复边界规则）
4. 修改页面时同步更新 frontmatter `updated`

### 更新 wiki.ingest.json

每处理完一个 target：从 `pending` 移除该 target，追加到 `completed`。Edit wiki.ingest.json 保存进度，确保中断后可从断点恢复。

## Summary 阶段

### 1. 重建报告

按 type 分组输出：

```markdown
## 增量同步完成

### 直接受影响（已更新）
- features/login.md
  → 更新：状态枚举新增 CONNECTING

### 间接影响（已处理）
- flows/auth-flow.md ← 涉及 auth 模块
  → 基于 guideline 更新
```

跳过的 target 单独标注说明。

### 2. 清理

删除 `docs/wiki/wiki.ingest.json`。

### 3. 更新 index.md + 追加 log.md

- Edit `docs/wiki/index.md`，将 `updated` 更新为当前秒级 ISO 时间戳
- 追加变更日志到 `docs/wiki/log.md`，格式：

```markdown
## [2026-04-21] ingest | 增量同步

- 变更文件：src/auth/LoginService.kt, src/user/UserService.kt（anchor: abc123）
- 更新：features/login.md, modules/auth.md
- 关键发现：LoginService 新增双 token 刷新机制
```

### 4. 建议后续

- 人工审查更新的页面
- 运行 `/sw:lint` 进行健康检查
- 下次变更后继续使用 `/sw:ingest`
