---
name: sw:init-act-refine
description: "跨模块一致性检查，创建 flow 页面，完善 overview"
user-invocable: false
context: fork
agent: wiki-maintainer
---

执行跨模块一致性精炼。

## 执行流程

### 1. 读取上下文

读取 `docs/wiki/wiki.json`：
- 确认 `process.completedModules` 不为空
- 读取 `features` 中所有条目的 `imports` 字段，构建符号→features 反向索引
- 读取 `process.estimatedFlows` 获取预估的跨模块流程

如果 `process.completedModules` 为空，输出错误信息并停止。

### 2. 两阶段回读

**Pass 1 — 交叉索引**：扫描所有 features 的 imports，构建符号→features 映射。每个被多个 feature 引用的符号就是一个需要交叉比对的检查点。

**Pass 2 — 精确深读**：只对 Pass 1 中发现的交叉检查点相关页面做深读 + 内容比对。读这些页面的完整内容（不限于 frontmatter）。

### 3. 一致性检查

基于 Pass 2 的深读结果，逐项检查并直接修复发现的问题：

- **命名一致性**：同一概念是否在不同模块中用了不同术语（如"用户认证"vs"身份验证"）
- **共享工具引用**：被多个模块使用的共享能力是否有独立页面且被正确引用
- **交叉引用**：有关系的 module 页面是否通过 `related` 字段互相链接
- **归属完整性**：每个 feature 页面的 `module` 字段是否指向正确的模块

### 4. 创建 flow 页面

基于 `process.estimatedFlows` 和各模块页面中发现的跨模块协作关系，创建跨模块业务流程页面。遵循 Flows 的定位规则（仅跨模块流程才独立建页）。

参考 `${CLAUDE_PLUGIN_ROOT}/templates/flow.md` 创建页面。

在 `wiki.json` 的 `flows` 中创建对应条目：`modules`（涉及的模块列表）、`page`（wiki 页面路径）。

### 5. 完善 overview.md

补充以下内容（参考 `${CLAUDE_PLUGIN_ROOT}/templates/overview.md`）：
- 架构概览和系统分层
- 模块间关系和依赖图
- 关键设计决策
- 技术栈详情

更新 `wiki.json` 的 `architectures.pages`，注册 overview 等架构级页面。

### 6. 最终更新

- 更新 `index.md`：完整版导航，包含所有已创建的页面
- 追加 `log.md`：记录 refine 阶段的所有变更
- 更新 `wiki.json`：`process` 最小化为 `{phase: "completed"}`（删除 pendingModules、completedModules、processingOrder、estimatedFlows），`revision` +1，更新 `lastUpdated`

### 7. 返回摘要

返回以下格式的摘要：

```
## Refine 结果

### 一致性问题
- 已修复：[列表]
- 需人工确认：[列表]

### 创建的 flow 页面
- docs/wiki/flows/xxx.md — [描述]

### overview.md 更新
- [新增内容摘要]

### 建议审查区域
- [需人工确认的区域]
```
