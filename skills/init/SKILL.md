---
name: sw:init
description: "全量分析：扫描源码 → 逐模块处理 → 收尾。自动检测状态从断点继续"
argument-hint: "[source-path]"
user-invocable: true
disable-model-invocation: true
---

全量初始化——从源码构建完整的 wiki 知识库。

源码路径: $ARGUMENTS

## 1. 前置步骤

读取 `${CLAUDE_PLUGIN_ROOT}/schemas/wiki-schema.md` 加载共享规则（知识模型、frontmatter schema、页面格式、修改协议、修复边界）。

## 2. 状态判断

Glob `docs/wiki/wiki.*.json`：

| 状态 | 动作 |
|------|------|
| 有 wiki.init.json | 中断恢复（AskUserQuestion 三选项：恢复/保留重建/完全重来） |
| 有其他 wiki.*.json | 拒绝："另一个操作正在进行中。请先完成。" |
| 有 wiki 页面但无临时文件 | AskUserQuestion：重新全量分析（覆盖）还是用 `/sw:ingest` 增量？ |
| 空目录 | 进入步骤 3 |

## 3. 扫描规划

### 3.1. 扫描源码元数据

按以下顺序操作（只读签名和结构，不读实现）：

1. **目录结构**：Glob 源码目录（depth 3），排除 node_modules/、vendor/、dist/、build/、out/、.git/、docs/wiki/
2. **包管理文件**（选最相关的一个）：Read package.json / pom.xml / go.mod / Cargo.toml / pyproject.toml
3. **README.md**：Read
4. **导出签名**：Grep `export` 语句（签名行，不读文件内容）
5. **测试文件名**：Glob `*.test.*` / `*.spec.*` / `*_test.*`

### 3.2. 综合分析

基于扫描结果：

- **确定模块边界**（依据：目录结构）
  - 有子目录：每个子目录为一个模块
  - 无子目录（平目录）：所有文件视为单一模块
- 为每个模块列出预估的 features、keyFiles（3-5 个代表性文件）
- **跨目录耦合分析**：从 export/import 数据中识别跨目录引用，标注被外部高频引用的文件（可能是横切关注点，不应归入单一业务模块）
- 标注低置信度区域
- 平目录项目文件数 > 20 时，主动建议拆分依据
- 统计源码文件总量，确定委派策略（≤ 50 主会话内联，> 50 可委派 Agent tool，最多 5 agent）

### 3.3. 创建 wiki.init.json

```json
{
  "pending": ["<所有模块名>"],
  "completed": [],
  "plan": {
    "<模块名>": {
      "source": "src/auth/",
      "features": ["login", "register"],
      "keyFiles": ["AuthService.kt", "LoginController.kt", "TokenManager.kt"]
    }
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| pending | string[] | 待处理模块名列表 |
| completed | string[] | 已完成模块名列表 |
| plan | object | 模块规划，Phase 1 写入，Phase 2 只读 |
| plan[X].source | string | 模块对应的源码目录 |
| plan[X].features | string[] | 预估 feature 名称列表 |
| plan[X].keyFiles | string[] | 代表性文件（3-5 个），用于确认时展示 |

**状态流转**：Phase 1 扫描后写入 plan + pending → 逐模块处理，将模块从 pending 移到 completed → Phase 3 收尾后删除文件。

### 3.4. 检查点 — 用户确认

AskUserQuestion 展示模块划分方案：

> **模块划分方案**（基于目录结构自动推断）：
>
> - auth (src/auth/, 12 files)
>   关键文件: AuthService.kt, LoginController.kt, TokenManager.kt
>   → features: login, register, token-refresh
>
> - order (src/order/, 8 files)
>   关键文件: OrderService.kt, PaymentGateway.kt
>   → features: create, track
>
> ⚠ 跨目录耦合: auth.utils.kt 被 order/ 引用 3 次
> ⚠ 低置信度: utils/ 目录含多种不相关工具，建议评估是否拆分
>
> **委派策略**：源码共 ~45 文件，主会话内联处理
>
> 此划分是否合理？可以调整模块的合并、拆分或重命名。

展示内容来源：模块名和 features 来自 plan；关键文件来自 plan[X].keyFiles；跨目录耦合和低置信度来自步骤 3.2 分析。

用户确认后：如需调整则更新 wiki.init.json，进入步骤 4。

## 4. 逐模块处理

读取 wiki.init.json 获取 pending 列表，按步骤 3 确定的委派策略执行。

**委派策略**（文件总量 > 50 时启用）：
- 按模块关联度分组，最多 5 agent，顺序派发
- 每个 agent 完成后主会话更新 wiki.init.json，再派发下一个

### 4.1. 分析源码

按以下策略读取源码，目标：**~70% 准确率的知识骨架**——结构正确比细节完美更重要。

**必读（Tier 1）**：
- Grep 模块内 export 签名和 import 依赖
- 读类型定义、接口定义
- 读测试文件名和 describe 块标题
- 读 JSDoc / 注释 / docstring

**按需（Tier 2）**：
- Tier 1 基础上选择性读取最复杂的 2-3 个文件（导出最多、被引用最多的）

**不读**：函数体实现细节、测试断言、vendor / 生成 / 样板代码

**原则**：只写人类不容易从代码直接看到的内容（协作关系、设计意图、隐式约定）。不确定边界时宁可稍大。

### 4.2. 确定 features

按建页标准划分 feature：

- 有明确目的 + 能独立理解 -> 建 feature 页面
- 不满足 -> 内联到所属模块页面
- 太大（多目标） -> 拆分

### 4.3. 提取 guidelines

从源码中识别明确的设计决策，写入页面 guidelines：
- 架构选择（如"事件驱动"/"请求-响应"）
- 模块间通信约定
- 数据约束（如"所有 entity 有 createdAt/updatedAt"）
- 命名约定

每条 guideline 一句话，记录"为什么这样做"。仅提取代码中明确体现的决策，不推断设计意图。

### 4.4. 创建页面

- 读取 `${CLAUDE_PLUGIN_ROOT}/templates/feature.md` 和 `${CLAUDE_PLUGIN_ROOT}/templates/module.md`
- 创建 feature 页面（含完整 frontmatter：title、created、updated、source、tags、guidelines）
- 创建 module 页面（含完整 frontmatter：title、created、updated、features 引用、tags、guidelines）
- **一次性创建完整页面，不创建 stub**

feature 页面的 `source` 字段填充映射的源码文件路径。
module 页面的 `features` 字段填充 `[[features/页面名]]` 双链数组。

### 4.5. 自检

回读刚创建的页面，确认 frontmatter 与源码签名一致。只检查本模块内部。

### 4.6. 更新 wiki.init.json

从 pending 中移除该模块，追加到 completed。保存 wiki.init.json。

**Agent tool 委派模式**：agent 返回结果需包含：
- 跨模块关系线索（如"auth 模块导出 AuthService，被 order 模块引用"）
- 低置信度区域

主会话收集后用于步骤 5。主会话内联模式下此信息在上下文中隐式保留。

### 4.7. 全部模块完成 → 进入收尾

pending 为空，进入步骤 5。

## 5. 收尾

### 5.1. 推断 flow 并确认

基于步骤 4 收集的跨模块关系线索，推断业务流程。

**必须调用 AskUserQuestion** 展示推断结果（阻断步骤，未经确认不得创建 flow 页面）：

> **推断的业务流程**：
> - user-registration（用户注册）：[[features/register]] → [[features/email-verify]] → [[features/profile-init]]
> - order-fulfillment（订单履约）：[[features/create-order]] → [[features/payment]] → [[features/shipping]]
>
> 此列表是否合理？可以删除、修改描述或补充遗漏的流程。

### 5.2. 创建 flow 页面

用户确认后，读取 `${CLAUDE_PLUGIN_ROOT}/templates/flow.md`，创建 flow 页面。

### 5.3. 推断 architecture 页面并确认

基于已有全部页面（modules、features、flows）的上下文，推断需要哪些 architecture 级页面。overview.md 始终创建，其他页面根据项目特征判断。

**必须调用 AskUserQuestion** 展示推断结果（阻断步骤，未经确认不得创建 architecture 页面）：

> **Architecture 页面规划**：
> - overview.md（必选）
> - api.md — 项目暴露 12 个 REST 端点，建议创建 API 文档
> - deployment.md — 检测到 Dockerfile 和 docker-compose.yml，建议创建部署文档
> - conventions.md — 未检测到明显的 lint/style 配置，暂不建议
>
> 请确认要创建哪些页面。可以删除或补充。

### 5.4. 创建 architecture 页面

用户确认后：
1. 读取对应的 `${CLAUDE_PLUGIN_ROOT}/templates/` 模板
2. **回读源码**填充细节（如 api.md 需要读取路由定义，deployment.md 需要读取 Dockerfile 等）
3. 有源码证据的章节正常填充；无源码证据但模板要求的章节直接删除该章节；整个页面无足够信息则提示用户
4. 创建 architecture 页面（overview.md 必选，其他按确认结果）

### 5.5. 创建 index.md、log.md、.gitignore

- **index.md**：完整版导航，包含所有已创建的页面双链引用
- **log.md**：初始条目（格式见 wiki-schema.md 日志格式）
- **.gitignore**：确保排除 wiki.*.json：
  - 不存在 -> 创建，内容为 `wiki.*.json`
  - 已存在且不含该规则 -> 追加
  - 已存在且已含该规则 -> 跳过
  - 如 docs/wiki/ 已被 git track 且含 wiki.*.json -> 提示用户手动 `git rm --cached`

### 5.6. 删除 wiki.init.json

### 5.7. 更新 index.md.updated

将 index.md 的 `updated` 字段更新为当前秒级 ISO 时间戳。

### 5.8. 完成摘要

输出：
- **模块划分**：最终版与初始提案的差异（如有）
- **创建的页面清单**
- **关键发现**（汇总各模块分析结果）
- **低置信度区域**：标记供用户重点审查

建议：
- 运行 `/sw:lint` 进行健康检查
- 人工审查低置信度页面
- 后续源码变更时使用 `/sw:ingest` 增量同步
