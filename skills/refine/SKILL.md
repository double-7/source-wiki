---
name: sw:refine
description: "跨模块一致性检查，创建 flow 页面，完善 overview"
user-invocable: false
disable-model-invocation: true
context: user
---

执行跨模块一致性精炼。

## ★ 前置步骤 — 加载规则

**在执行任何操作之前，必须先读取以下文件获取所有共享规则：**

```
${CLAUDE_PLUGIN_ROOT}/agents/wiki-maintainer.md
```

此文件定义了 wiki 的层级体系、目录结构、页面格式约定、wiki.json 格式等所有规则。后续所有步骤必须严格遵循这些规则。

## 前置校验

检查 `docs/wiki/wiki.json`：

- **不存在** → 报错："wiki 尚未初始化。请先运行 `/sw:init`。"
- **`completedModules` 为空** → 报错："尚未完成任何模块的 Fill。请先运行 `/sw:fill` 或 `/sw:init`。"
- **正常** → 继续执行

## 执行步骤

### 1. 回读摘要

读所有 module 页面的 frontmatter 和第一段概述（不读完整内容）。

### 2. 一致性检查

逐项检查并直接修复发现的问题：

- **命名一致性**：同一概念是否在不同模块中用了不同术语（如"用户认证"vs"身份验证"）
- **共享工具引用**：被多个模块使用的共享能力是否有独立页面且被正确引用
- **交叉引用**：有关系的 module 页面是否通过 `related` 字段互相链接
- **归属完整性**：每个 feature 页面的 `module` 字段是否指向正确的模块

### 3. 创建 flow 页面

基于 wiki.json 中的 `plan.estimatedFlows` 和各模块页面中发现的跨模块协作关系，创建跨模块业务流程页面。遵循 wiki-maintainer.md 中 Flows 的定位规则（仅跨模块流程才独立建页）。

参考 `${CLAUDE_PLUGIN_ROOT}/templates/flow.md` 创建页面。

### 4. 完善 overview.md

补充以下内容（参考 `${CLAUDE_PLUGIN_ROOT}/templates/overview.md`）：
- 架构概览和系统分层
- 模块间关系和依赖图
- 关键设计决策
- 技术栈详情

### 5. 最终更新

- 更新 `index.md`：完整版导航，包含所有已创建的页面
- 追加 `log.md`：记录 refine 阶段的所有变更
- 更新 `wiki.json`：`phase="completed"`, `revision` +1, 更新 `lastUpdated`

## 完成输出

- 一致性问题列表（已修复 / 需人工确认）
- 创建的 flow 页面清单
- overview.md 新增内容摘要
- 建议用户重点审查的区域

并建议：
- 运行 `/sw:lint` 进行健康检查
- 人工审查低置信度页面
- 后续源码变更时使用 `/sw:ingest` 增量同步
