---
name: wiki-schema
description: 源码知识库 Schema 定义（知识模型、页面规范、共享规则）
---

# 源码知识库 Schema

你是源码知识库的**维护者**。你的职责是创建、更新、查询和维护关于源码的结构化知识库。

**wiki 输出目录**：当前项目的 `docs/wiki/`。
**模板文件**：`${CLAUDE_PLUGIN_ROOT}/templates/`。

## 1. 知识模型

```
architecture  ← 基于 feature/module/flow 归纳产生的系统级文档
    ↑
flow          ← 描述程序如何完成业务目标的协作流程
    ↑
module        ← 代码实现视角的归纳分组（不限于业务领域）
    ↑
feature       ← 实现明确目的的最小能力单元
```

每层只描述本层级内容，不越级。

### 1.1 目录结构

```
docs/wiki/
├── index.md              # 导航页（系统锚点，不可删除）
├── log.md                # 变更日志（append-only，git diff 锚点）
├── wiki.init.json        # 临时：init 运行状态（完成后删除）
├── wiki.ingest.json      # 临时：ingest 运行状态（完成后删除）
├── wiki.lint.json        # 临时：lint 运行状态（完成后删除）
├── .gitignore            # 排除 wiki.*.json
├── modules/              # 模块文档
├── features/             # 功能文档
├── flows/                # 协作流程
├── architectures/        # 项目架构级文档
└── queries/              # 查询沉淀
```

**页面类型由文件所在目录确定，不在 frontmatter 中存储。**

### 1.2 页面类型速查

| 类型 | 粒度标准 | 关键约束 |
|------|---------|---------|
| feature | 有明确目的 + 能独立理解 | 太小（无明确目的）→内联到所属页面；太大（多目的）→拆分 |
| module | 包含相关 feature（多对多组合） | 分组依据不限业务领域——可以是技术关注点、基础设施、横切功能、共享工具 |
| flow | 一个完整业务目的 + 多能力单元（feature/module）的协作 | 引用涉及的 module 和 feature（均为可选） |
| architecture | 项目整体 | 不重复 feature/module 实现细节；从底层归纳产生 |

## 2. 页面规范

### 2.1 命名与链接

- **命名**：小写英文 + 连字符：`user-login.md`
- **链接**：双链格式 `[[类型目录/页面名]]`（如 `[[features/login]]`），自然融入正文。每个页面至少有一个入站链接。

### 2.2 模板参考

创建页面时读取 `${CLAUDE_PLUGIN_ROOT}/templates/<类型>.md`：
`index.md`、`overview.md`、`module.md`、`feature.md`、`flow.md`、`api.md`、`conventions.md`、`deployment.md`

### 2.3 通用字段

| 字段 | 类型 | 说明 |
|------|------|------|
| title | string | 人类可读标题，与文件名语义一致 |
| created | string | ISO 8601 秒级时间戳（`2026-04-21T14:30:00Z`） |
| updated | string | ISO 8601 秒级时间戳，每次修改时更新 |
| tags | string[] | 自由标签。module 可用关注点标签（`infrastructure`、`cross-cutting`、`utility`） |
| guidelines | string[] | 设计决策约束，记录为什么这样做 |
| issues | string[] | 待处理问题，格式：`问题描述 — 来源 日期` |

### 2.4 关系字段

- **`depends`**（平级引用）：同类型页面依赖，所有类型可选
- **类型命名字段**（下级引用）：字段名即目标目录名（`features`、`modules`、`flows`），值为 `[[<目录>/<页面名>]]` 双链数组

信息单向存储在下级引用字段中（组合→被组合），反向查询通过脚本实现：

```bash
# "login feature 属于哪个 module？"
node ${CLAUDE_PLUGIN_ROOT}/scripts/query-wiki.js --dir docs/wiki --type module --field features --contains "[[features/login]]"

# "auth module 涉及哪些 flow？"
node ${CLAUDE_PLUGIN_ROOT}/scripts/query-wiki.js --dir docs/wiki --type flow --field modules --contains "[[modules/auth]]"
```

### 2.5 各类型专属字段

**Feature**（`features/`）：

```yaml
source: ["src/auth/LoginService.kt", "src/auth/LoginController.kt"]
depends: ["[[features/token-refresh]]"]
```

`source` 必需（非空字符串数组）；`depends` 可选。

**Module**（`modules/`）：

```yaml
features: ["[[features/login]]", "[[features/register]]"]
depends: ["[[modules/user]]"]
```

`features` 必需（非空双链数组，多对多）；`depends` 可选。

**Flow**（`flows/`）：

```yaml
modules: ["[[modules/auth]]"]
features: ["[[features/login]]"]
depends: []
```

`modules`、`features`、`depends` 均可选。

**Architecture**（`architectures/`）：

```yaml
modules: ["[[modules/auth]]"]
flows: ["[[flows/login-flow]]"]
features: []
depends: []
```

所有关系字段可选。

**Query**（`queries/`）：仅 `depends`（可选）。

**Index**（`docs/wiki/index.md`）：仅 `title`、`created`、`updated` 必需。

## 3. 共享规则

### 3.1 Guidelines 使用规则

- 修改任何 wiki 页面前，先读取该页面的 frontmatter `guidelines`，按原则修改
- 同模块下多个 feature 共享的设计决策，应提炼到 module 页面的 guidelines
- 当同类冲突反复出现时，主动建议用户补充 guideline

### 3.2 Issues 使用规则

- issues 记录待处理问题，供 lint 统一消费。非 lint 操作不处理 issues
- issues 是临时字段——写入后由 lint 在下次扫描时独立验证、修复并清除
- 跨页面问题写在当前命令能直接编辑的页面上

### 3.3 依赖驱动拆分

当 feature-A 内的某个能力被 feature-B 依赖时，该能力应拆分为独立 feature-C。A 和 B 都通过 depends 引用 C。

### 3.4 修改协议

任何修改 wiki 页面内容的操作必须遵循：

1. 读取目标页面的 frontmatter `guidelines`，按原则修改
2. 读取目标页面的 frontmatter `issues`（如存在），了解已知问题（仅 lint 处理 issues）
3. 执行修改
4. 更新 frontmatter `updated` 为当前秒级 ISO 时间戳

**例外**：仅写 issues 到 frontmatter（不做内容修改）时，只执行步骤 1-3，不更新 `updated`。

### 3.5 修复边界

```
自动修（无需确认）
  ├─ 路径替换（rename）
  ├─ 单页面事实修正（源码明确验证）
  └─ frontmatter 字段同步

需确认
  ├─ 单页面内容更新（非机械性）
  └─ 简单跨引用修正
  触发方式：AskUserQuestion 确认后执行

只记录不修（写 issues，留给 lint）
  ├─ 跨页面一致性修复
  ├─ 需要全局视角的判断（模块归属、层级调整）
  ├─ 信息不足以自信修复的任何场景
  └─ 结构性变更（页面拆分/合并/创建）
```

### 3.6 日志格式

`docs/wiki/log.md` 是 append-only 变更日志，无 frontmatter，不受 Hook 校验。

```markdown
## [2026-04-21] init | 用户认证模块

- 分析了 `src/auth/` 目录下的 5 个文件
- 创建了 [[modules/auth]] 模块页和 [[features/login]]、[[features/register]] 两个功能页
- 关键发现：认证服务使用了双 token 刷新机制
```

格式：`## [日期] 操作 | 标题` + 操作要点 + 关键发现。

### 3.7 index.md 系统角色

导航页（系统关键文件，不可删除）。`updated` 字段由命令在收尾时与 log.md 同步更新。

## 4. 临时文件规范

### 4.1 命名与互斥

临时文件命名：`wiki.<命令>.json`（init / ingest / lint）。query 不使用临时文件。

同一时间只有一个编排命令活跃。启动前检查：

```
Glob docs/wiki/wiki.*.json
→ 有结果：报告当前状态，拒绝启动
→ 无结果：允许启动
```

### 4.2 生命周期

```
命令启动 → 检查互斥 → 创建 wiki.<cmd>.json → 编排执行 → 删除文件 → 更新 index.md/log.md
```

**状态即存在性**：文件不存在 = 未运行，文件存在 = 运行中/中断。

### 4.3 中断恢复

检测到 wiki.<cmd>.json 存在时，提供三选项：

| 选项 | 行为 |
|------|------|
| 恢复 | 读取临时文件状态，从断点继续 |
| 保留重建 | 删除临时文件，扫描已完成页面，仅重新规划未完成部分 |
| 完全重来 | 删除临时文件 + 删除所有 wiki 页面 |
