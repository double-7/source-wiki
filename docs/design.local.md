# source-wiki 设计文档

## 1. 概述

### 1.1 插件定位

`source-wiki` 是 Claude Code 插件，将源码快速映射为结构化 wiki 知识库。利用大模型加速处理，推动知识持续积累与复用；人负责审核校正，保持专注与方向。

### 1.2 核心原则

| 原则 | 含义 |
|------|------|
| 页面即真相 | wiki 页面（frontmatter + 内容）是唯一持久数据源，无外部索引 |
| 结构 > 完美 | 骨架正确比细节准确更重要，细节由人校正 |
| 可校正 > 自洽 | 生成的内容应易于定位和修改 |
| 确定性 > 推理 | Hook 和脚本执行固定规则，LLM 负责推理，两者不交叉 |
| 可验证 > 推测 | wiki 中的事实性内容（常量值、方法签名、类引用）应可从源码验证，不依赖 LLM 推测 |

### 1.3 三层架构

```
产品层   init / ingest / lint / query    ← 定义 wiki 生命周期
架构层   数据模型 + 状态管理 + 安全机制   ← 定义持久和临时数据规范
实现层   schema(WHAT) + skill(HOW)       ← 定义规则和执行流程
```

三层文档角色：

| 文档 | 角色 | 内容 | 被引用 |
|------|------|------|--------|
| `docs/design.local.md` | WHY | 决策理由、架构分工、项目地图 | 不被运行时引用 |
| `schemas/wiki-schema.md` | WHAT | 规则、模型、约束（含共享临时文件规范） | 被 SKILL.md 运行时引用 |
| `skills/*/SKILL.md` | HOW | 执行流程、各自的 wiki.*.json schema | 自包含，不引用本文档 |

## 2. 产品层

四个命令定义 wiki 的完整生命周期：

| 命令 | 职责 | 执行模式 | 读写 |
|------|------|---------|------|
| init | 扫描源码，创建结构化 wiki（三模式：覆盖/参考/重定向 ingest） | 单会话自包含（可委派） | 读 + 写 |
| ingest | 检测源码变更，增量同步 wiki，提取 guidelines（单页）+ 记录 [guideline] issues（跨页），支持意图参数和非交互模式 | 单会话自包含 | 读 + 写 |
| lint | 健康检查，发现并修复问题，提炼 guidelines，支持指令模式 | 单会话自包含 | 读 + 写 |
| query | 基于 wiki 回答问题，沉淀有价值分析 | 直接执行 | 读 + 可能写 |

## 3. 数据模型

### 3.1 知识层级

```
architecture  ← 基于 feature/module/flow 归纳产生的系统级文档
    ↑
flow          ← 描述程序如何完成业务目标的协作流程
    ↑
module        ← 代码实现视角的归纳分组（不限于业务领域）
    ↑
feature       ← 实现明确目的的最小能力单元
```

每层只描述本层级内容，不越级。字段定义和页面类型详见 `wiki-schema.md §1-2`。

### 3.2 关系模型设计

关系字段分两类，按 WHY 设计：

- **`depends`（平级引用）**：只限同类型引用。设计理由：避免跨类型依赖的语义歧义。跨类型关联通过下级引用字段或正文描述。
- **类型命名字段（下级引用）**：字段名即目标类型目录名（`features`、`modules`、`flows`），值为 `[[目录/页面名]]` 双链。设计理由：字段名自带类型信息，Hook 可按字段名直接校验链接格式。
- **信息单向存储**：关系存在下级引用字段中（组合→被组合），反向查询通过脚本实现。设计理由：避免双写，单一写入点保证一致性。

字段定义详见 `wiki-schema.md §2.3-2.5`，查询命令详见 `wiki-schema.md §2.4`。

### 3.3 系统文件角色

**index.md** — 导航页（系统关键文件，不可删除）：
- 人类导航：结构化页面目录，双链引用
- 时间戳锚点：`updated` 字段由命令在收尾时单点更新，保证原子性

**log.md** — 变更日志（append-only，无 frontmatter，不受 Hook 校验）：
- 记录每次命令的操作要点和关键发现
- git diff 锚点：ingest 通过 `git log -1 --format=%H -- docs/wiki/log.md` 获取变更基准点

格式详见 `wiki-schema.md §3.6-3.7`。

## 4. 状态管理

### 4.1 临时状态模型

每个编排命令使用独立的临时文件追踪运行状态：

```
wiki.init.json     ← init 运行时存在，完成后删除
wiki.ingest.json   ← ingest 运行时存在，完成后删除
wiki.lint.json     ← lint 运行时存在，完成后删除
```

query 不使用临时文件（直接执行）。

生命周期：`命令启动 → 检查互斥 → 创建 wiki.<cmd>.json → 编排执行 → 删除文件 → 更新 index.md/log.md`

**状态即存在性**：文件不存在 = 未运行，文件存在 = 运行中/中断。设计理由：无需额外清理机制，磁盘状态即运行状态。

互斥规则和生命周期细节详见 `wiki-schema.md §4`。各命令的 JSON schema 详见对应 SKILL.md。

### 4.2 互斥与恢复

**互斥**：同一时间只有一个编排命令活跃。设计理由：避免并发写入导致页面内容冲突。

**恢复三选项**（检测到 wiki.<cmd>.json 存在时）：

| 选项 | 行为 |
|------|------|
| 恢复 | 从断点继续 |
| 保留重建 | 扫描已完成页面，仅重新规划未完成部分 |
| 完全重来 | 删除所有 wiki 页面和临时文件 |

设计理由：保留重建利用"页面即真相"原则——已完成页面是自包含的；完全重来适用于确认上次结果不可用。二选项（仅恢复/重来）会丢失中间粒度的恢复能力。

恢复语义详见 `wiki-schema.md §4.1-4.3`。

## 5. 安全机制

### 5.1 Hook 架构

单一 Hook 脚本，根据写入文件的路径/后缀决定校验策略：

```
hooks/wiki-hook.js
├── wiki.init.json    → 校验 init schema
├── wiki.ingest.json  → 校验 ingest schema
├── wiki.lint.json    → 校验 lint schema
└── docs/wiki/**/*.md → 校验 frontmatter
```

设计理由：Hook 是确定性脚本，硬编码固定规则，不做推理。规则变更时同步修改 Hook 脚本。校验规则详见 `hooks/wiki-hook.js`。

### 5.2 Hook 失败处理

| 触发时机 | 失败行为 | LLM 响应 |
|---------|---------|---------|
| PreToolUse（Write） | 阻断写入，返回错误信息 | 根据错误信息修正，重新写入 |
| PostToolUse（Edit） | 警告，不阻断 | 根据错误信息判断是否修正 |

设计理由：Hook 返回具体校验失败原因（如 `"missing required field: source"`），LLM 根据具体原因修正后重试，无需人工介入。这是"确定性 > 推理"原则的体现——Hook 管规则边界，LLM 管修正策略。

## 6. 查询机制

### 6.1 设计哲学

**LLM 负责推理，脚本负责固定的机械操作，两者不交叉。** 脚本不做判断或推理，只执行确定的扫描、提取、过滤。

`scripts/query-wiki.js` 提供结构化 frontmatter 查询（按类型、字段值过滤、全量导出）。接口详见 `scripts/query-wiki.js`。

### 6.2 YAML 解析策略

使用内嵌的 js-yaml（`libs/js-yaml-4.1.1.min.js`，MIT 许可）解析 frontmatter。设计理由：自写解析器存在边界 case 风险；直接打包无需用户安装依赖。

Frontmatter 格式限制为已知子集：扁平 key-value，值类型 string / string[] / empty array，数组只用行内语法。

## 7. 项目地图

### 7.1 组件依赖

```
                    wiki-schema.md (WHAT)
                    知识模型、页面规范、共享规则
                           ↑ read
            ┌──────────────┼──────────────┐
            │              │              │
      init/SKILL.md  ingest/SKILL.md  lint/SKILL.md  query/SKILL.md
      (HOW + schema) (HOW + schema)  (HOW + schema)  (HOW)
            │              │              │              │
            │ call         │ call         │ call         │ call
            ↓              ↓              ↓              ↓
      query-wiki.js ────────────────────────────────────────
      frontmatter 结构化查询
            ↑ requires
      js-yaml-4.1.1.min.js

      wiki-hook.js (独立组件)
      校验 wiki.*.json schema + frontmatter
```

读/写关系：

| 组件 | 读 | 写 |
|------|----|----|
| init/SKILL.md | wiki-schema.md, 源码, templates, wiki 页面（参考模式） | wiki 页面, wiki.init.json |
| ingest/SKILL.md | wiki-schema.md, 源码, wiki 页面 | wiki 页面, wiki.ingest.json |
| lint/SKILL.md | wiki-schema.md, wiki 页面, 源码（CODE 验证/遗漏检测/指令模式） | wiki 页面, wiki.lint.json |
| query/SKILL.md | wiki-schema.md, wiki 页面, 源码, templates（沉淀时） | wiki 页面（沉淀时） |
| query-wiki.js | wiki 页面 frontmatter | 无 |
| wiki-hook.js | 写入中的文件内容 | 无（仅校验） |

### 7.2 组件职责

| 组件 | 职责 | 文件 | 被谁用 |
|------|------|------|--------|
| Schema | 知识模型、页面规范、共享规则、临时文件通用规范 | `schemas/wiki-schema.md` | 所有 SKILL.md 运行时加载 |
| init | 全量扫描→创建 wiki（三模式：覆盖/参考/重定向 ingest） | `skills/init/SKILL.md` | 用户 `/sw:init` |
| ingest | 变更检测→影响分析→逐 target 处理（direct/indirect/intent）+ guidelines 提取，支持参数和非交互模式 | `skills/ingest/SKILL.md` | 用户 `/sw:ingest` |
| lint | 五维度健康检查（含事实性验证）+ guidelines 提炼 + 指令模式 | `skills/lint/SKILL.md` | 用户 `/sw:lint` |
| query | 知识检索→回答→可能沉淀 | `skills/query/SKILL.md` | 用户 `/sw:query` |
| Templates | 9 种页面模板 | `templates/*.md` | init/query 创建页面时加载 |
| Hook | 写入校验（frontmatter + 临时文件） | `hooks/wiki-hook.js` | Claude Code 自动触发 |
| Query Script | frontmatter 结构化查询 | `scripts/query-wiki.js` | ingest/lint/query 调用 |
| YAML Lib | YAML 解析 | `libs/js-yaml-4.1.1.min.js` | Hook 和 Query Script |

### 7.3 文件结构

```
my-agent-plugin/
├── .claude-plugin/
│   └── plugin.json            ← 插件清单
├── schemas/
│   └── wiki-schema.md         ← WHAT：知识模型、页面格式、共享规则
├── skills/
│   ├── init/SKILL.md          ← 扫描规划 → 逐模块处理 → 收尾
│   ├── ingest/SKILL.md        ← 变更检测 → 影响分析 → 逐 target 处理
│   ├── lint/SKILL.md          ← 维度规划 → 逐维度检查 → 报告
│   └── query/SKILL.md         ← 查询 → 回答 → 可能沉淀
├── templates/
│   ├── index.md               ← 导航页模板
│   ├── overview.md            ← 架构总览模板
│   ├── module.md              ← 模块模板
│   ├── feature.md             ← 功能模板（含 source）
│   ├── flow.md                ← 流程模板
│   ├── api.md                 ← API 文档模板（architecture 级）
│   ├── conventions.md         ← 开发规范模板（architecture 级）
│   ├── deployment.md          ← 部署文档模板（architecture 级）
│   └── query.md               ← 查询沉淀模板
├── hooks/
│   └── wiki-hook.js           ← 校验（按后缀分发）
├── scripts/
│   └── query-wiki.js          ← frontmatter 结构化查询
├── libs/
│   └── js-yaml-4.1.1.min.js   ← 内嵌 YAML 解析库（MIT）
└── docs/
    └── design.local.md        ← 本文档（WHY 层）
```

运行时产物（在被分析的目标项目中）：

```
<target-project>/docs/wiki/
├── index.md                   ← 导航页（命令维护 updated）
├── log.md                     ← 变更日志（append-only，git diff 锚点）
├── wiki.init.json             ← 临时：init 运行状态（完成后删除）
├── wiki.ingest.json           ← 临时：ingest 运行状态（完成后删除）
├── wiki.lint.json             ← 临时：lint 运行状态（完成后删除）
├── .gitignore                 ← 排除 wiki.*.json（init 自动生成）
├── modules/                   ← 模块文档
├── features/                  ← 功能文档（含 source 字段）
├── flows/                     ← 流程文档
├── architectures/             ← 架构文档
└── queries/                   ← 查询沉淀
```

## 8. 关键决策记录

| # | 决策 | 理由 | 替代方案 |
|---|------|------|---------|
| 1 | 消除 wiki.json，用临时文件 + 页面即真相 | 消除持久索引与页面元数据的双写问题 | 保留 wiki.json 但分离索引和过程 |
| 2 | wiki.<cmd>.json 临时文件 | 状态即存在性，完成后删除，无清理负担 | 单一 wiki.json + process 清零 |
| 3 | Frontmatter 6 通用字段 + 类型专属关系字段 | source 仅 feature 有自然映射；depends 同类型引用；类型命名字段引用下级 | source 统一为文件数组 |
| 4 | 删除 type 字段 | 目录已表达类型，frontmatter 再存是双写 | 保留 type 用于 hook 校验 |
| 5 | related 拆分为 depends + 类型命名字段 | 消除语义歧义；depends 只含同类型，类型命名字段表达组合关系（组合→被组合） | 单一 related 字段 + 隐式语义表 |
| 6 | log.md 作为 git diff 锚点 | log.md 由命令单点写入，无并发问题；append-only 语义天然适合时间线锚定 | index.md.updated（Hook 自动更新有并发风险） |
| 7 | 命令单点更新 index.md.updated | 单会话内无并发写入风险；与 log.md 写入同步 | Hook 自动更新（并发风险） |
| 8 | 时间戳秒级精度（ISO 8601） | 天级精度无法区分同日多次操作 | 保持天级 |
| 9 | Hook 按后缀硬编码校验规则 | Hook 是确定性脚本，规则固定，无需推理 | Hook 读取外部配置 |
| 10 | JS 脚本替代 Grep 查询 frontmatter | Grep 解析 YAML 不可靠，脚本提供结构化输出 | 用 Grep + 正则匹配 |
| 11 | 中断恢复提供三选项（恢复/保留重建/完全重来） | 保留重建利用"页面即真相"原则，已完成页面是自包含的；完全重来适用于确认上次结果不可用 | 仅恢复/完全重来二选一 |
| 12 | LLM 推理 + 脚本执行 | LLM 做判断，脚本做机械操作，职责不交叉 | 全部由 LLM 处理 |
| 13 | ~~临时文件 schema 在设计文档统一定义~~ → 见 #19 | 三个命令的 schema 具备对照价值，集中定义便于维护 | 各 SKILL.md 独立定义 |
| 14 | 双链格式 `[[目录/页面名]]`，字段名即目标类型 | 消除同名歧义；Hook 可按字段名直接校验链接格式 | `[[页面名]]` 简短但有歧义风险 |
| 15 | Hook 失败返回具体原因，LLM 重试 | LLM 可根据具体错误修正，无需人工介入 | Hook 仅返回 pass/fail，由用户判断 |
| 16 | module→feature 为多对多组合关系 | 实际项目中 feature 可被多个 module 组合（如通用日志 feature）；lint 检查"每个 feature 被至少一个 module 组合" | 严格一对多（一个 feature 只属于一个 module） |
| 17 | 内嵌 js-yaml 解析 YAML | 自写解析器存在边界 case 风险；js-yaml MIT 许可，直接打包无需用户安装 | 自写 YAML 子集解析器 |
| 18 | 放宽数据模型约束 | 原始约束过严：module 只允许业务领域导致基础设施/工具无处安放；flow 强制 ≥2 模块导致单模块内流程无处记录；feature 强制 ≥2 文件导致单文件能力无处建页 | 保留更严格约束 |
| 19 | wiki.*.json schema 在各自 SKILL.md 内联定义（推翻 #13） | SKILL.md 自包含；schema 是 HOW 的一部分（命令创建什么结构）；design.local.md 不应是运行时引用源 | 集中在 wiki-schema.md（WHAT 层，但各命令 schema 结构不同，非共享规则） |
| 20 | Guidelines 作为 CODE→WIKI 反馈通道 | 无新字段 = 无 Hook/Schema 变更；guidelines 已定义"设计决策约束"，用户修正经验在语义上是设计决策 | 独立 feedback.md（引入新持久化文件增加维护成本） |
| 21 | Init 三选项（覆盖/参考/重定向 ingest） | 覆盖=纯 CODE；参考=CODE 为主+借鉴 guidelines；ingest=增量同步。避免二选一丢失中间态 | 仅覆盖/ingest 二选项 |
| 22 | Ingest 参与闭环（单页 guidelines + 跨页 [guideline] issues） | ingest 是唯一同时读 CODE 和 WIKI 但不提取 guidelines 的命令，是闭环的断裂点 | ingest 只做增量同步不提取 |
| 23 | Lint guidelines 提炼（pattern 批量模式） | 收集 findings，LLM 语义判断同类，≥2 同组→候选；减少噪声 | per-issue 提炼（产生大量琐碎 guidelines） |
| 24 | Lint 指令模式（用户意图 > CODE 证据） | lint 是唯一接受用户指令调整 wiki 的命令；用户明确表述即执行 | 不支持指令模式 |
| 25 | Lint 遗漏检测（CODE 有但 WIKI 没有） | coverage 维度扫描源码未覆盖文件聚集目录，发现缺失的知识 | 仅检查 wiki 内部一致性 |
| 26 | Lint consistency 增加 CODE 验证 | 抽样读源码与 wiki 描述比对，检测描述与源码不一致 | 仅 wiki 页面间交叉比对 |
| 27 | 砍掉 query 矛盾提炼（Direction C） | 单次 query 会话发现 ≥2 同类矛盾概率极低；query 已有矛盾检测写 issues 足够 | 跨 query 会话积累矛盾提炼 guidelines |
| 28 | Lint 渐进增强而非完全重写 | 维度驱动→对比驱动不是范式转换；现有四维度流程已验证，完全重写是净风险 | 重构为 Wiki vs CODE 对比流程 |
| 29 | 参考模式下消失模块的 guidelines 丢弃 | 模块消失意味着源码结构已变，旧 guidelines 上下文不再适用 | LLM 判断归属迁移（误判风险 > 知识损失） |
| 30 | Init/Lint 重叠可接受，通过"起点"区分 | init 起点 CODE（生成），lint 起点 WIKI（维护）。成本和风险不对称 | 合并为单一命令（增加用户认知负担） |
| 31 | Ingest 参数作为软约定（`$ARGUMENTS` 纯文本，LLM 自行解析） | SKILL.md 是 prompt，不需要代码级预处理；CE ce-plan 验证可行性 | 结构化参数 schema |
| 32 | 影响分析新增 intent target type | intent 推导置信度低于 direct，需独立标记便于审查和差异化处理 | 归入 direct |
| 33 | 非交互模式保守策略（`--auto` 下 indirect 不修改页面） | indirect 缺乏直接证据，自动化处理风险高，交由 lint 更安全 | 全量自动处理 |
| 34 | Diff 策略统一 `git diff <anchor>`（含 working tree） | 匹配"改完→同步→一起提交"工作流 | 三级策略（committed/staged/working tree） |
| 35 | Guidelines 老化/死亡为愿景性描述，lint 一致性检查是其唯一实际执行机制 | 避免过度工程；init/ingest 冲突检测 + lint 一致性检查已覆盖核心场景 | 每次 lint 全量比对所有 guidelines 与 CODE |
| 36 | Lint 新增 factual 维度（事实性验证） | 常量值错误是最常见且最危险的 wiki 问题（反馈实战发现 3 处常量值错误）；系统性提取-比对机制优于 consistency 的抽样验证 | 扩展 consistency 维度的 CODE 验证 |
| 37 | Init 关键常量采集 + Ingest 常量值变更检测 | wiki 从创建起应有可验证的事实锚点；ingest 应感知常量值变更触发关联页面更新 | init 只提取结构不提取常量值 |
| 38 | query-wiki.js --fulltext 全文搜索 | 跨字段全文搜索是高频查询场景（如搜索引用了某类的所有页面） | 仅支持单字段查询 |
