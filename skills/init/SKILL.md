---
name: sw:init
description: "阶段式全量分析：Plan → Fill → Refine。自动检测状态从断点继续"
argument-hint: "[source-path]"
user-invocable: true
disable-model-invocation: true
context: user
---

阶段式全量初始化——从源码构建完整的 wiki 知识库。

源码路径: $ARGUMENTS

## ★ 前置步骤 — 加载规则

**在执行任何操作之前，必须先读取以下文件获取所有共享规则：**

```
${CLAUDE_PLUGIN_ROOT}/agents/wiki-maintainer.md
```

此文件定义了 wiki 的层级体系、目录结构、页面格式约定、Feature 粒度规则、wiki.json 格式等所有规则。后续所有阶段的操作必须严格遵循这些规则。

**特别注意以下规则（常见遗漏点）：**
- 页面必须按目录分类存放：`modules/`、`features/`、`flows/`、`architectures/`、`queries/`
- 每个 wiki 页面必须包含完整的 YAML frontmatter（title、type、created、updated、source、tags、related、module）
- Feature 页面的 frontmatter 必须包含 `module` 字段指向所属模块
- 使用 Obsidian 双链语法 `[[页面名]]` 进行交叉引用
- 模板文件位于 `${CLAUDE_PLUGIN_ROOT}/templates/`，创建页面时按需读取对应模板

## 阶段状态机

读取 `docs/wiki/wiki.json` 判断当前状态，决定执行哪个阶段：

| wiki.json 状态 | 动作 |
|----------------|------|
| 不存在 | 执行 **Plan 阶段** |
| `phase == "completed"` | 询问用户："wiki 已存在且完整。要重新全量分析（将覆盖现有内容），还是使用 `/sw:ingest` 做增量更新？" |
| `phase == "planned"` | 展示已有 plan，请用户确认后执行 **Fill 阶段** |
| `phase == "filling"` | 从 `pendingModules` 继续执行 **Fill 阶段** |
| `phase == "filled"` | 执行 **Refine 阶段** |
| `phase == "refining"` | 执行 **Refine 阶段** |

## Plan 阶段 — 扫描 + 骨架 + 检查点

**目标**：只读元数据，产出结构化计划和页面骨架。此阶段不读源码实现，永远不会爆上下文。

### 读取清单

1. **目录结构**：Glob 项目目录（depth 3）
2. **包管理文件**（选读最相关的一个）：`package.json` / `pom.xml` / `go.mod` / `Cargo.toml` / `pyproject.toml`
3. **README.md**
4. **入口文件**（1-2 个）：`main.*` / `index.*` / `app.*`
5. **导出签名**：Grep `export` 语句（全项目，仅匹配行，不读文件内容）
6. **依赖关系**：Grep `import` / `require` 语句（全项目，仅匹配行）
7. **类型文件**：Glob `*.d.ts` / `types/*` / `interfaces/*`
8. **测试文件名**：Glob `*.test.*` / `*.spec.*` / `*_test.*`

### 产出

1. **wiki.json**：含完整 `plan`（techStack、modules 含 features/keyFiles/dependencies、processingOrder、estimatedFlows）
2. **overview.md**：骨架版，参考 `${CLAUDE_PLUGIN_ROOT}/templates/overview.md`，填入项目名和技术栈，其余留空
3. **每个 module 的 stub 页面**：仅 frontmatter + 一句话概述，参考 `${CLAUDE_PLUGIN_ROOT}/templates/module.md`
4. **index.md**：导航骨架，参考 `${CLAUDE_PLUGIN_ROOT}/templates/index.md`
5. **log.md**：初始条目

wiki.json 设置：`revision=1`, `phase="planned"`, `pendingModules=[所有模块]`, `completedModules=[]`, `fillFindings={}`

### ★ 检查点 — 用户确认

使用 AskUserQuestion 展示计划：

> **模块划分方案**：
> - auth (src/auth/, ~12 files) → features: login, register, token-refresh
> - order (src/order/, ~8 files) → features: create, track
>
> **处理顺序**：auth → order → payment（按依赖关系从底层到上层）
>
> **预估跨模块流程**：用户认证流程
>
> 此划分是否合理？可以调整模块的合并、拆分或重命名。

**必须等待用户确认后才能继续。** 用户确认后：
- 如用户要求调整，按调整后的方案更新 wiki.json
- 进入 Fill 阶段

## Fill 阶段 — 逐模块深读 + 页面生成

通过 Agent tool 逐模块委派 Worker 执行，每个模块获得独立的上下文窗口。

### 编排流程

```
for each module M in pendingModules (按 processingOrder):
```

1. **Spawn Worker**：使用 Agent tool（`subagent_type: "general-purpose"`），prompt 按下方 Worker 模板填写
   - `{PREVIOUS_FINDINGS}` 占位符替换为前序模块的 fillFindings 汇总（首次为空）
2. **接收返回**：解析 Worker 返回的摘要（创建了哪些页面、sourceMap 条目、关键发现）
3. **更新 wiki.json**：
   - 将 M 从 `pendingModules` 移入 `completedModules`
   - 更新 `sourceMap`（Worker 返回的页面→源文件映射）
   - 将发现存入 `fillFindings[M]`
   - `phase` 设为 `"filling"`, `revision` +1, 更新 `lastUpdated`
4. **更新 index.md**：添加新页面条目
5. **进度输出**：每完成 2-3 个模块输出简要进度（不暂停等待回复）
6. **检查剩余容量**：
   - 已使用超过 120 turns → 保存状态，输出进度，退出并提示："已完成 X/Y 模块。再次运行 /init 继续处理剩余模块。"
   - 否则 → 继续下一个模块

### 全部模块完成

- `phase` 设为 `"filled"`, `revision` +1, 更新 `lastUpdated`
- 输出 Fill 阶段摘要
- 自动进入 Refine 阶段（如果 turns 充足，剩余 > 40 turns），否则提示用户再次运行

### Worker Prompt 模板

对每个模块，使用 Agent tool spawn worker，prompt 如下（替换花括号占位符）：

```
你是 wiki 页面创建者。为模块 "{MODULE_NAME}" 创建 wiki 页面。

## 步骤

1. 读取规则：${CLAUDE_PLUGIN_ROOT}/agents/wiki-maintainer.md
2. 读取模板：${CLAUDE_PLUGIN_ROOT}/templates/feature.md 和 ${CLAUDE_PLUGIN_ROOT}/templates/module.md
3. 分析源码目录：{SOURCE_PATH}
   - Tier 1：用 Grep 提取 export 签名和 import 依赖，读类型定义和测试文件名，读注释/JSDoc
   - Tier 2：选择性读取最复杂的 2-3 个文件（导出最多、被引用最多的）
   - 跳过：工具函数、简单 CRUD、样板代码、vendor 代码、生成代码
4. 创建 feature 页面（写入 docs/wiki/features/），遵循 feature 粒度规则
5. 更新 module 页面详情（docs/wiki/modules/{MODULE_NAME}.md）
6. 返回以下格式的摘要（严格按此格式，不要做其他事情）：

## 模块：{MODULE_NAME}

### 创建的页面
- docs/wiki/features/xxx.md → [src/file1.ts, src/file2.ts]
- docs/wiki/modules/xxx.md → [src/xxx/]

### 关键发现
- 发现 1
- 发现 2

### 低置信度区域
- xxx 可能有误，建议人工审查（说明原因）

### 前序发现注入
{PREVIOUS_FINDINGS}
```

**替换占位符**：
- `{MODULE_NAME}` → 模块名
- `{SOURCE_PATH}` → 模块源码目录路径
- `{PREVIOUS_FINDINGS}` → 前序模块的关键发现摘要（格式："模块A: 发现1; 发现2\n模块B: 发现3"），首次为空字符串

**注意**：Worker 会自行读取 wiki-maintainer.md 规则和模板文件。你不需要压缩或传递这些内容。

## Refine 阶段 — 跨模块一致性

所有模块 Fill 完成后执行：

1. **回读摘要**：读所有 module 页面的 frontmatter 和第一段概述（不读完整内容）
2. **一致性检查**：
   - 命名是否一致（同一概念是否用了不同术语）
   - 共享工具是否被正确引用
   - module 页面的 `related` 字段是否互相链接
   - 每个 feature 页面的 `module` 字段是否指向正确的模块
3. **创建 flow 页面**：基于 `plan.estimatedFlows` 和 fillFindings 中发现的跨模块协作关系，参考 `${CLAUDE_PLUGIN_ROOT}/templates/flow.md`
4. **完善 overview.md**：补充架构概览、模块间关系、关键设计决策、技术栈详情
5. **最终更新 index.md**：完整版导航
6. **追加 log.md**
7. **更新 wiki.json**：`phase="completed"`, `revision` +1, 更新 `lastUpdated`

## 完成摘要

在控制台输出：

- **模块划分**：最终版与初始提案的差异
- **创建/更新的页面清单**
- **关键发现**（汇总各 Worker 的发现）
- **低置信度区域**：标记供用户重点审查的页面或段落

并建议：

- 运行 `/sw:lint` 进行健康检查
- 人工审查低置信度页面
- 后续源码变更时使用 `/sw:ingest` 增量同步
