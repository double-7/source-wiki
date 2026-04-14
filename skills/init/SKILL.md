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
| `process.phase == "completed"` | 询问用户："wiki 已存在且完整。要重新全量分析（将覆盖现有内容），还是使用 `/sw:ingest` 做增量更新？" |
| `process.phase == "planned"` | 展示已有 modules 和 processingOrder，请用户确认后执行 **Fill 阶段** |
| `process.phase == "filling"` | 从 `process.pendingModules` 继续执行 **Fill 阶段** |
| `process.phase == "filled"` | 执行 **Refine 阶段** |
| `process.phase == "refining"` | 执行 **Refine 阶段** |

## Plan 阶段 — 委派

通过 Skill tool 调用 `sw:plan`，在独立的 fork 上下文中执行源码扫描和模块划分。Plan 在自己的上下文窗口中运行，不占用 init 的上下文。

### 编排流程

1. **调用 plan**：使用 Skill tool 调用 `sw:plan`，参数为源码路径
2. **确认完成**：读取 `docs/wiki/wiki.json`，确认 `process.phase` 已设为 `"planned"`
3. **进入检查点**

### ★ 检查点 — 用户确认

读取 `docs/wiki/wiki.json` 中的 `modules` 和 `process.processingOrder`，使用 AskUserQuestion 展示模块划分方案：

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

## Fill 阶段 — 逐模块委派

通过 Skill tool 逐模块调用 `sw:fill`，每个模块在独立的 subagent 上下文中执行。

### 编排流程

读取 `wiki.json` 获取 `process.pendingModules`，按 `process.processingOrder` 顺序逐个处理：

1. **调用 fill**：使用 Skill tool 调用 `sw:fill`，参数为目标模块名
2. **确认完成**：读取 `wiki.json`，确认该模块已从 `process.pendingModules` 移入 `process.completedModules`（fill skill 自行更新 wiki.json）
3. **进度输出**：每完成 2-3 个模块输出简要进度（不暂停等待回复）
4. **继续下一个**：重复直到 `process.pendingModules` 为空

### 容量检查

每完成一个模块后评估：
- 如果已使用超过 120 turns → 保存状态并退出，提示："已完成 X/Y 模块。再次运行 `/sw:init` 继续处理剩余模块。"
- 否则 → 继续下一个模块

### 全部模块完成

读取 `wiki.json` 确认 `process.phase` 已更新为 `"filled"`。如果 turns 充足（剩余 > 40 turns），自动进入 Refine 阶段。否则提示用户再次运行 `/sw:init`。

## Refine 阶段 — 跨模块一致性

通过 Skill tool 调用 `sw:refine`，在独立的 subagent 上下文中执行。

调用完成后，读取 `wiki.json` 确认 `process.phase` 已更新为 `"completed"`。

## 完成摘要

在控制台输出：

- **模块划分**：最终版与初始提案的差异
- **创建/更新的页面清单**
- **关键发现**（汇总各模块的 exports/conventions）
- **低置信度区域**：标记供用户重点审查的页面或段落

并建议：

- 运行 `/sw:lint` 进行健康检查
- 人工审查低置信度页面
- 后续源码变更时使用 `/sw:ingest` 增量同步
