---
name: sw:fill
description: "深度分析指定模块源码，生成 wiki 页面。支持 /fill auth 或 /fill --all"
argument-hint: "[module-name | --all]"
user-invocable: false
disable-model-invocation: true
context: user
---

对指定模块执行深度源码分析并生成 wiki 页面。

参数: $ARGUMENTS

## ★ 前置步骤 — 加载规则

**在执行任何操作之前，必须先读取以下文件获取所有共享规则：**

```
${CLAUDE_PLUGIN_ROOT}/agents/wiki-maintainer.md
```

此文件定义了 wiki 的层级体系、目录结构、页面格式约定、Feature 粒度规则、wiki.json 格式等所有规则。后续所有步骤必须严格遵循这些规则。

## 前置校验

检查 `docs/wiki/wiki.json`：

- **不存在** → 报错："wiki 尚未初始化。请先运行 `/sw:init` 进行全量分析。"
- **`phase` 不是 `"planned"`、`"filling"` 或 `"filled"`** → 报错："wiki 状态不允许 fill（当前阶段：{phase}）。请先运行 `/sw:init`。"
- **正常** → 继续执行

## 参数解析

- `$ARGUMENTS` 为空或 `--all` → 处理所有 `pendingModules`
- `$ARGUMENTS` 为模块名 → 处理指定模块（必须在 `pendingModules` 中）

## 执行流程

对每个目标模块按以下步骤执行：

### Tier 1 — 签名与类型（2-3 turn）

- Grep 模块内的 export 签名和 import 依赖
- 读类型定义（`*.d.ts`、`types/*`、`interfaces/*`）
- 读测试文件名和 `describe` 块标题（揭示意图，不读断言）
- 读 JSDoc / 注释

### Tier 2 — 目标采样（2-3 turn）

基于 Tier 1 发现，选择性读取：
- 最复杂的文件（导出最多、类型层次最深）
- 被多个文件引用的跨切面文件
- **跳过**：工具函数、简单 CRUD、样板代码、vendor 代码、生成代码

### 创建页面（2-3 turn）

- 创建 feature 页面（遵循 wiki-maintainer.md 中的 Feature 粒度边界规则）
- 填充 module 页面详细内容
- 不确定 feature 边界时，宁可创建稍大的页面，备注"可能需要拆分"

### 自检（1-2 turn）

- 回读刚创建的页面，确认描述与签名一致
- 只检查本模块内部一致性

### 更新状态

- 更新 `index.md` 中该模块的条目
- 更新 `wiki.json`：
  - 将完成的模块从 `pendingModules` 移入 `completedModules`
  - 在 `sourceMap` 中注册新增页面的文件映射
  - `revision` +1, 更新 `lastUpdated`

### 进度输出

每完成一个模块，输出简要进度：
> 已完成模块：[列表]。剩余：[列表]。关键发现：[摘要]。继续处理下一模块...
