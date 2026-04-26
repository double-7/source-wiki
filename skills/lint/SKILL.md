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

## 状态判断

Glob `docs/wiki/wiki.*.json`：

| 状态 | 动作 |
|------|------|
| 有 wiki.lint.json | 中断恢复（AskUserQuestion 三选项：恢复/保留重建/完全重来） |
| 有其他 wiki.*.json | 拒绝："另一个操作正在进行中。请先完成。" |
| 无临时文件 | 确认 docs/wiki/ 存在且有页面 → 继续 Detect；不存在 → 报错"请先运行 `/sw:init`" |

## Detect 阶段 — 规划检查范围

### 1. 确定扫描模式

解析 `$ARGUMENTS`：

- **无参数** → 全量扫描（`scope: ""`）
- **有参数**（如 `auth`）→ 定向扫描：
  1. 使用 query-wiki.js 查找匹配的 module 页面
  2. 匹配到 → 范围：该模块页面 + 关联 feature 页面 + 涉及该模块的 flow
  3. 未匹配 → 报错："未找到模块 '{参数}'。可用模块：" + 列表，退出

### 2. 全量扫描获取当前状态

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/query-wiki.js --dir docs/wiki --dump
```

### 3. 创建 wiki.lint.json

```json
{
  "scope": "",
  "dimensions": {
    "freshness": "pending",
    "coverage": "pending",
    "integrity": "pending",
    "consistency": "pending"
  },
  "findings": []
}
```

`scope`：定向模式为模块名，全量模式为空字符串。

无需检查点（lint 是只读检查，低风险）。

## Loop 阶段

读取 wiki.lint.json 获取 dimensions 状态。

```
loop:
  1. Skill tool 调用 sw:lint-act（无参数，lint-act 自主处理所有 pending 维度）
  2. Grep wiki.lint.json 确认维度完成情况
  3. 记录 act 返回的摘要
  4. 仍有 pending → 回到步骤 1
  5. 全部 completed → 进入 Report

catch（步骤 2 确认无新维度完成时触发）：
  1. 重试：重新派发 lint-act（fork 获得新上下文）
  2. 再次检查维度完成情况
     - 有进展 → 回到 loop 步骤 4
     - 仍无进展 → 跳过剩余维度，进入 Report（附跳过说明）
```

## Report 阶段

### 1. 读取检查结果

读取 wiki.lint.json 的 findings 重建完整报告。

### 2. 按 fixType 分组

- **safe（已修复）**：lint-act 已直接执行，报告中标注"已修复"
- **content（待确认）**：需要用户确认的内容修复方案
- **none（仅报告）**：无法自动修复的问题

### 3. 输出结构化报告

按四个维度组织输出，safe 标注"已修复"。每个维度列出 findings。

### 4. 内容修复确认

如有 fixType == "content" 的 findings，AskUserQuestion 展示修复方案：

> 以下内容修复方案待确认：
>
> 1. [consistency] features/user-login.md: "三状态" → "四状态"
>    方案：更新状态描述与 module 页面一致
>
> 是否执行？

选项：全部执行 / 逐项选择 / 跳过。

用户确认后执行修复、更新页面 frontmatter `updated`。

### 5. 清理

删除 `docs/wiki/wiki.lint.json`。

### 6. 更新 index.md.updated + 追加 log.md

- 将 index.md 的 `updated` 更新为当前秒级 ISO 时间戳
- 按格式追加检查结果摘要：维度和发现数、已修复和待确认的问题、建议后续步骤
