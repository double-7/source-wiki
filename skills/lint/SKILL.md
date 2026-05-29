---
name: sw:lint
description: "对 wiki 知识库进行健康检查。单会话自包含流程：规划维度、逐维度检查、汇总报告"
argument-hint: "[module-name | instruction]"
user-invocable: true
---

对 wiki 知识库进行健康检查。支持全量扫描、定向分析和指令模式。

## 1. 前置步骤

读取 `${CLAUDE_PLUGIN_ROOT}/schemas/wiki-schema.md` 加载共享规则。

## 2. 状态判断

Glob `docs/wiki/wiki.*.json`：

| 状态 | 动作 |
|------|------|
| 有 wiki.lint.json | 中断恢复（AskUserQuestion 三选项：恢复/保留重建/完全重来） |
| 有其他 wiki.*.json | 拒绝："另一个操作正在进行中。请先完成。" |
| 无临时文件 | 确认 docs/wiki/ 存在且有页面 → 继续规划；不存在 → 报错"请先运行 `/sw:init`" |

## 3. 规划检查范围

### 3.1. 确定扫描模式

解析 `$ARGUMENTS`：

- **无参数** → 全量扫描（`scope: ""`，`mode: "scan"`）
- **模块名**（如 `auth`）→ 定向扫描（`mode: "scan"`）：
  1. 使用 query-wiki.js 查找匹配的 module 页面
  2. 匹配到 → 范围：该模块页面 + 关联 feature 页面 + 涉及该模块的 flow
  3. 未匹配 → 尝试指令模式（见下）
- **自然语言指令**（非模块名）→ 指令模式（`mode: "instruct"`）：
  - 将 `$ARGUMENTS` 解析为用户意图（如"检查认证相关的描述是否准确"）
  - 识别涉及的 wiki 页面范围
  - 用户意图为最高优先级
  - 破坏性操作需额外确认

当参数不是已知模块名时，LLM 判断是模块名匹配失败还是用户指令。判断依据：参数长度 > 5 个词、包含动词/描述性语句 → 指令模式。

### 3.2. 全量扫描获取当前状态

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/query-wiki.js --dir docs/wiki --dump
```

### 3.3. 创建 wiki.lint.json

```json
{
  "scope": "",
  "mode": "scan",
  "dimensions": {
    "freshness": "pending",
    "coverage": "pending",
    "integrity": "pending",
    "consistency": "pending"
  },
  "findings": [],
  "suggestedGuidelines": []
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| scope | string | `""` = 全量扫描，模块名 = 针对性扫描 |
| mode | string | `"scan"` = 全量/定向扫描，`"instruct"` = 指令模式 |
| dimensions | object | 四维度执行状态 |
| dimensions[X] | string | `"pending"` 或 `"completed"`（X ∈ {freshness, coverage, integrity, consistency}） |
| findings | finding[] | 累积发现 |
| suggestedGuidelines | object[] | guideline 候选列表 |

**suggestedGuidelines 结构**：

| 字段 | 类型 | 说明 |
|------|------|------|
| targetPage | string | 建议写入的页面相对路径 |
| text | string | guideline 内容（一句话） |
| evidence | string[] | 来源 finding/issue 的描述列表 |

**finding 结构**：

| 字段 | 类型 | 说明 |
|------|------|------|
| dimension | string | 发现该问题的维度 |
| severity | string | `"high"` / `"medium"` / `"low"` |
| page | string | 受影响页面相对路径 |
| description | string | 问题描述 |
| fixType | string | `"safe"`（可自动修）/ `"content"`（需确认）/ `"none"`（仅报告） |
| fixPlan | string | 修复方案（如适用） |

**状态流转**：初始化 dimensions（全部 pending）→ 逐维度检查，标记 completed + 追加 findings → 汇总报告后删除文件。

无需检查点（lint 是只读检查，低风险）。

## 4. issues 消费

在维度检查前执行。使用 query-wiki.js 查找有 issues 的页面：

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/query-wiki.js --dir docs/wiki --field issues --not-empty
```

对每个有 issues 的页面，逐个验证：

- **源码可验证且属于机械修正**（见 wiki-schema.md §3.5）→ 修复并清除 issue
- **源码可验证但属于内容更新** → 升级为 finding（fixType: content），追加到 wiki.lint.json 的 findings
- **需要用户判断** → 升级为 finding（fixType: content），追加到 wiki.lint.json 的 findings
- **问题已不存在** → 直接清除 issue
- **Issue 含 `[guideline]` 前缀** → guideline 候选处理：提取 issue 中描述的模式，转为 suggestedGuideline 追加到 wiki.lint.json，清除该 issue

修复时遵循修改协议：
1. 读取目标页面的 frontmatter `guidelines`，按原则修改
2. 读取目标页面的 frontmatter `issues`（如存在），了解已知问题
3. 执行修改
4. 更新 frontmatter `updated` 为当前秒级 ISO 时间戳

仅写 issues 到 frontmatter（不做内容修改）时，不更新 `updated`。

## 5. 维度检查

对 wiki.lint.json 中每个 pending 维度，按顺序执行：freshness → coverage → integrity → consistency。每完成一个维度即时保存。

### 5.1. freshness — 源码路径有效性

使用 query-wiki.js 获取所有 feature 页面的 source 字段：

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/query-wiki.js --dir docs/wiki --type feature
```

Glob 验证每个 source 路径是否存在。不存在的标记为 finding：

- severity: high
- fixType: none
- fixPlan: "源码文件已删除或移动"

### 5.2. coverage — 覆盖完整性

- 扫描所有 wiki 页面文件
- 检查：正文中 `[[dir/name]]` 双链都有对应的实际文件
- 检查：无孤立页面（每个页面至少被一个其他页面或 index.md 引用）
- 缺失的标记为 finding，severity: medium
- **遗漏检测**：扫描源码目录，收集未被任何 feature 页面 `source` 字段覆盖的源码文件。未覆盖文件聚集在同一目录（≥ 3 个）→ 标记为 finding，severity: medium，建议新建 feature 或扩展已有 feature。零散文件可忽略。

### 5.3. integrity — 数据完整性

使用 query-wiki.js --dump 获取全量 frontmatter：

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/query-wiki.js --dir docs/wiki --dump
```

检查：
- 每个页面 frontmatter 必需字段完整
- depends 和类型命名字段的双链格式正确
- 无遗留的旧格式字段（type、related）

### 5.4. consistency — 内容一致性

- 读取多个页面内容进行交叉比对
- 同一概念在不同页面术语一致
- 页面内容匹配其层级（如 flow 页面不应描述单 feature 的内部实现）
- 交叉引用有效：depends 引用目标页面存在；下级引用目标页面存在
- **CODE 验证**：对 feature 页面的 `source` 字段引用的源码文件，抽样读取关键部分（导出签名、类型定义），与 wiki 描述比对。描述与源码不一致 → 标记为 finding，severity 按偏差程度定（high: 核心逻辑错误；medium: 细节不准确；low: 表述可优化）

### 5.5. 即时保存

每完成一个维度，追加 findings 并保存 wiki.lint.json。每条 finding 包含：dimension、severity（high/medium/low）、page、description、fixType（safe/content/none）、fixPlan。safe 类型直接修复（更新页面内容和 frontmatter）。

确保中断后已完成的维度结果不丢失。

### 5.6. Guidelines 提炼

分析所有 findings 中的重复模式：

1. LLM 语义判断哪些 findings 描述同类问题（不依赖关键词匹配）
2. 同类 findings ≥ 2 个 → 候选 guideline
3. 每个候选 guideline 生成：
   - targetPage: 建议写入哪个页面（通常为涉及的 module 或 feature 页面）
   - text: guideline 内容（一句话，描述"应怎样做"）
   - evidence: 来源 finding 列表
4. 对比目标页面已有 guidelines：
   - 已存在相同或高度重合 → 合并更新
   - 目标页面 guidelines 总数 > 10 → 建议精简
5. 追加到 wiki.lint.json.suggestedGuidelines（与步骤 4 中 `[guideline]` issues 合并）

### 5.7. 指令模式执行

当 mode == "instruct" 时，在维度检查和 guidelines 提炼完成后执行：

1. 将用户指令解析为具体操作列表
2. 对每个操作：
   - 涉及的 wiki 页面存在 → 读取页面 + 读取相关源码验证
   - 用户指令与 CODE 事实矛盾 → 警告但不阻断，AskUserQuestion 确认
   - 破坏性操作（删除 > 50% 内容、清空 guidelines、删除系统文件）→ AskUserQuestion 额外确认
3. 用户确认后执行操作，更新页面 frontmatter `updated`

## 6. 汇总报告

### 6.1. 读取检查结果

读取 wiki.lint.json 的 findings 重建完整报告。

### 6.2. 按 fixType 分组

- **safe（已修复）**：维度检查中已直接执行，报告中标注"已修复"
- **content（待确认）**：需要用户确认的内容修复方案
- **none（仅报告）**：无法自动修复的问题

### 6.3. 输出结构化报告

按四个维度组织输出，safe 标注"已修复"。每个维度列出 findings。

### 6.4. 内容修复确认

如有 fixType == "content" 的 findings，AskUserQuestion 展示修复方案：

> 以下内容修复方案待确认：
>
> 1. [consistency] features/user-login.md: "三状态" → "四状态"
>    方案：更新状态描述与 module 页面一致
>
> 是否执行？

选项：全部执行 / 逐项选择 / 跳过。

用户确认后执行修复、更新页面 frontmatter `updated`。

### 6.5. Guidelines 确认

如有 suggestedGuidelines（来自 findings 模式提炼 + `[guideline]` issues 升级），AskUserQuestion 展示：

> 以下 guidelines 建议添加：
> 1. [modules/auth.md] "认证服务统一使用 OAuth2 协议"
>    依据：features/login 和 features/token-refresh 均出现协议描述不一致
> 是否添加？

用户逐条确认后，写入对应页面的 guidelines 字段，更新 frontmatter updated。用户拒绝的 guideline 丢弃。

### 6.6. 清理

删除 `docs/wiki/wiki.lint.json`。

### 6.7. 更新 index.md.updated + 追加 log.md

- 将 index.md 的 `updated` 更新为当前秒级 ISO 时间戳
- 按格式追加检查结果摘要：维度和发现数、已修复和待确认的问题、建议后续步骤
