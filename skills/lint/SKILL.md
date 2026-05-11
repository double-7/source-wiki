---
name: sw:lint
description: "对 wiki 知识库进行健康检查。单会话自包含流程：规划维度、逐维度检查、汇总报告"
argument-hint: "[module-name]"
user-invocable: true
disable-model-invocation: true
---

对 wiki 知识库进行健康检查。支持全量和定向分析。

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

- **无参数** → 全量扫描（`scope: ""`）
- **有参数**（如 `auth`）→ 定向扫描：
  1. 使用 query-wiki.js 查找匹配的 module 页面
  2. 匹配到 → 范围：该模块页面 + 关联 feature 页面 + 涉及该模块的 flow
  3. 未匹配 → 报错："未找到模块 '{参数}'。可用模块：" + 列表，退出

### 3.2. 全量扫描获取当前状态

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/query-wiki.js --dir docs/wiki --dump
```

### 3.3. 创建 wiki.lint.json

Schema 引用 design.local.md §4.7：

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

## 4. issues 消费

在维度检查前执行。使用 query-wiki.js 查找有 issues 的页面：

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/query-wiki.js --dir docs/wiki --field issues --not-empty
```

对每个有 issues 的页面，逐个验证：

- **源码可验证** → 修复并清除 issue
- **需要用户判断** → 升级为 finding（fixType: content），追加到 wiki.lint.json 的 findings
- **问题已不存在** → 直接清除 issue

修复时遵循修改协议：读 guidelines → 修复 → 更新 updated。

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

### 5.5. 即时保存

每完成一个维度，追加 findings 并保存 wiki.lint.json。每条 finding 包含：dimension、severity（high/medium/low）、page、description、fixType（safe/content/none）、fixPlan。safe 类型直接修复（更新页面内容和 frontmatter）。

确保中断后已完成的维度结果不丢失。

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

### 6.5. 清理

删除 `docs/wiki/wiki.lint.json`。

### 6.6. 更新 index.md.updated + 追加 log.md

- 将 index.md 的 `updated` 更新为当前秒级 ISO 时间戳
- 按格式追加检查结果摘要：维度和发现数、已修复和待确认的问题、建议后续步骤
