---
name: sw:fill
description: "深度分析指定模块源码，生成 wiki 页面"
argument-hint: "[module-name]"
user-invocable: false
disable-model-invocation: true
context: fork
agent: wiki-maintainer
---

对指定模块执行深度源码分析并生成 wiki 页面。

目标模块: $ARGUMENTS

## 执行流程

### 1. 读取上下文

读取 `docs/wiki/wiki.json`，获取以下信息：

- 从 `process.pendingModules` 确认目标模块存在
- 从 `modules[目标]` 获取模块的 source 路径、features 列表、dependencies
- 从 `modules[依赖模块].exports` 读取跨模块公共接口
- 从 `modules[依赖模块].conventions` 读取命名/设计约定
- 从 `features`（依赖模块的）.imports 了解接口使用方式

如果 `wiki.json` 不存在或模块不在 `process.pendingModules` 中，输出错误信息并停止。

**可选**（上下文窗口允许时）：读取依赖模块的 wiki page 获取完整上下文。

### 2. 分析源码

按 wiki-maintainer.md 中的阅读策略执行：

- **Tier 1**（2-3 turn）：Grep 模块内的 export 签名和 import 依赖，读类型定义，读测试文件名和 describe 块标题，读 JSDoc / 注释
- **Tier 2**（2-3 turn）：选择性读取最复杂的 2-3 个文件（导出最多、被引用最多的）
- **跳过**：工具函数、简单 CRUD、样板代码、vendor 代码、生成代码

### 3. 创建页面

- 读取 `${CLAUDE_PLUGIN_ROOT}/templates/feature.md` 和 `${CLAUDE_PLUGIN_ROOT}/templates/module.md` 获取页面结构
- 创建 feature 页面（遵循 Feature 粒度边界规则）
- 填充 module 页面详细内容
- 不确定 feature 边界时，宁可创建稍大的页面，备注"可能需要拆分"

### 4. 自检

- 回读刚创建的页面，确认描述与源码签名一致
- 只检查本模块内部一致性

### 5. 更新状态

**更新 wiki.json**：
- 将完成的模块从 `process.pendingModules` 移入 `process.completedModules`
- 写入 `modules[当前模块].exports` — 分析源码时发现的导出符号列表
- 写入 `modules[当前模块].conventions` — 命名/设计约定
- 创建 `features` 中每个新 feature 的条目：`module`（所属模块名）、`source`（映射的源码文件）、`imports`（从其他模块引入的符号）、`page`（wiki 页面路径）
- `revision` +1，更新 `lastUpdated`
- 如果 `process.pendingModules` 为空，`process.phase` 设为 `"filled"`

**更新 index.md**：添加新页面条目

### 6. 返回摘要

返回以下格式的摘要（严格按此格式）：

```
## 模块：{MODULE_NAME}

### 创建的页面
- docs/wiki/features/xxx.md → [src/file1.ts, src/file2.ts]
- docs/wiki/modules/xxx.md → [src/xxx/]

### 关键发现
- 发现 1
- 发现 2

### 低置信度区域
- xxx 可能有误，建议人工审查（说明原因）
```
