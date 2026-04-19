---
name: sw:lint
description: "对 wiki 知识库进行健康检查。编排器模式：规划维度、委派检查、汇总报告"
argument-hint: "[module-name]"
user-invocable: true
disable-model-invocation: true
---

REACT 编排器——对 wiki 知识库进行健康检查。支持全量和定向分析。

## 前置步骤

读取 `${CLAUDE_PLUGIN_ROOT}/agents/wiki-maintainer.md` 加载共享规则。

## 前置校验

读取 `docs/wiki/wiki.json`：

- **不存在** → 报错："wiki 尚未初始化。请先运行 `/sw:init`。"
- **`process.phase == "linting"`** → 中断恢复，跳到 Loop 阶段
- **`process.phase` 为其他非 completed 值** → 提示："另一个操作正在进行中（{phase}）。请先完成。"
- **`process.phase == "completed"`** → 新 lint，继续 Detect

## Detect 阶段 — 规划检查范围

### 1. 读取 wiki 状态

读取 wiki.json 的 modules、features、flows 规划检查范围。

### 2. 确定扫描模式

解析 `$ARGUMENTS`：

- **无参数** → 全量扫描，扫描所有 wiki 页面
- **有参数**（如 `auth`）→ 定向扫描：
  1. 在 modules 中查找匹配（精确或包含关键词）
  2. 匹配到 → 范围：该模块页面 + features 页面 + 涉及该模块的 flows
  3. 未匹配 → 报错："未找到模块 '{参数}'。可用模块：{列表}"，退出

### 3. 定向模式范围外 issues 交互（仅定向模式）

扫描范围内页面 issues 数量 N，范围外 K。K > 0 时 AskUserQuestion：

> {模块名} 范围内有 {N} 个待处理 issues。
> 其他模块有 {K} 个 issues。
> 选项：只处理范围内 / 全面修复

### 4. 生成检查清单

四个检查维度：

| 维度 | 检查内容 |
|------|---------|
| `freshness` | source 路径和 features[X].source 是否指向有效文件 |
| `coverage` | 所有模块有页面、无孤立页面、双链无断裂 |
| `consistency` | 页面间事实一致、页面内容匹配其层级 |
| `integrity` | wiki.json 与实际页面一致、frontmatter 字段完整 |

### 5. 写入 wiki.json

```json
{
  "process": {
    "phase": "linting",
    "dimensions": {
      "freshness": "pending",
      "coverage": "pending",
      "consistency": "pending",
      "integrity": "pending"
    },
    "findings": [],
    "scope": "auth"
  }
}
```

`scope`：定向模式为模块名，全量模式为空字符串 `""`。

无需检查点（lint 是只读检查，低风险）。

## Loop 阶段

读取 wiki.json 获取 dimensions 初始状态。

```
loop:
  1. Skill tool 调用 sw:lint-act（无参数，lint-act 自主处理所有 pending 维度）
  2. Grep wiki.json 确认维度完成情况
  3. 记录 act 返回的摘要
  4. 仍有 pending → 回到步骤 1
  5. 全部 completed → 进入 Report
```

lint-act 容量不足时会保存已完成的维度进度并退出，编排器只需继续调用。

## Report 阶段

### 1. 读取检查结果

读取 wiki.json process.lint.findings 重建完整报告。

### 2. 按 fixType 分组

- **safe（已修复）**：lint-act 已直接执行，报告中标注"已修复 ✓"
- **content（待确认）**：需要用户确认的内容修复方案
- **none（仅报告）**：无法自动修复的问题

### 3. issues 处理摘要

```
已处理的 issues：
- {页面名}：{issue 描述} → 已修复/已清除/待确认
```

### 4. 输出结构化报告

按四个维度组织输出，safe 标注"已修复 ✓"。每个维度列出 findings。

### 5. 内容修复确认

如有 fixType == "content" 的 findings，AskUserQuestion 展示修复方案：

> 以下内容修复方案待确认：
>
> 1. [consistency] user-login.md: "三状态" → "四状态"
>    方案：更新状态描述与 module 页面一致
>
> 是否执行？

选项：全部执行 / 逐项选择 / 跳过。

用户确认后执行修复、更新 wiki.json revision、更新页面 updated 日期。

### 6. 清理 wiki.json

process 最小化为 `{phase: "completed"}`，revision +1，更新 lastUpdated。

### 7. 追加 log.md

检查维度和结果摘要、发现数量和严重程度、已修复和待确认的问题列表、建议后续步骤。
