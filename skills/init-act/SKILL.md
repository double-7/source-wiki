---
name: sw:init-act
description: "分析单个模块源码，创建 wiki 页面"
argument-hint: "[module-name]"
user-invocable: false
context: fork
agent: wiki-maintainer
---

分析指定模块源码并创建 wiki 页面。由 `sw:init` 编排器通过 Skill tool 调用。

目标模块: $ARGUMENTS

## 执行步骤

### 1. 读取上下文

读取 `docs/wiki/wiki.json`：
- 从 `process.queue` 确认目标模块存在
- 从 `modules[目标]` 获取 source 路径和 feature 预估
- 从 `process.completed` 中已完成模块的页面了解依赖关系（可选，上下文允许时）

如果模块不在 queue 中，输出错误并停止。

### 2. 分析源码

按以下策略读取源码，目标：**~70% 准确率的知识骨架**——结构正确比细节完美更重要。

**必读（Tier 1）**（2-3 turn）：
- Grep 模块内 export 签名和 import 依赖
- 读类型定义、接口定义
- 读测试文件名和 describe 块标题
- 读 JSDoc / 注释 / docstring

**按需（Tier 2）**（2-3 turn）：
- Tier 1 基础上选择性读取最复杂的 2-3 个文件（导出最多、被引用最多的）

**不读**：
- 函数体实现细节（除非 Tier 1 不够判断边界）
- 测试断言
- vendor / 生成 / 样板代码

**原则**：只写人类不容易从代码直接看到的内容（协作关系、设计意图、隐式约定）。不确定边界时宁可稍大。

### 3. 确定 features

按建页三条件划分 feature：
1. 能用一句话说清目标
2. 涉及 ≥2 个源码文件协作
3. 脱离上下文可独立理解

缺一则内联到所属模块页面。太大（多目标）则拆分。

### 4. 提取 guidelines

从源码中识别明确的设计决策，写入页面 guidelines：
- 架构选择（如"事件驱动"/"请求-响应"）
- 模块间通信约定
- 数据约束（如"所有 entity 有 createdAt/updatedAt"）
- 命名约定

每条 guideline 一句话，记录"为什么这样做"。仅提取代码中明确体现的决策，不推断设计意图。

### 5. 创建页面

- 读取 `${CLAUDE_PLUGIN_ROOT}/templates/feature.md` 和 `${CLAUDE_PLUGIN_ROOT}/templates/module.md`
- 创建 feature 页面（遵循建页三条件，包含提取到的 guidelines）
- 填充 module 页面详细内容（包含提取到的 guidelines）

### 6. 自检

回读刚创建的页面，确认描述与源码签名一致。只检查本模块内部。

### 7. 更新 wiki.json

- queue 中该模块移入 completed
- 创建 features 中每个新 feature 的条目：source（映射的源码文件）、page（wiki 页面路径）
- 更新 modules[当前].features 列表
- revision +1，更新 lastUpdated
- 如果 queue 全部完成，process.phase 设为 `"init-finalizing"`

### 8. 更新 index.md

添加新页面条目。

### 9. 返回摘要

严格按以下格式返回：

```
## 模块：{MODULE_NAME}

### 创建的页面
- docs/wiki/features/xxx.md → [src/file1.ts, src/file2.ts]
- docs/wiki/modules/xxx.md → [src/xxx/]

### 关键发现
- 发现 1
- 发现 2

### 跨模块关系线索
- auth 模块导出 AuthService，被 order 模块引用
- 无

### 低置信度区域
- xxx 可能有误，建议人工审查（说明原因）
```
