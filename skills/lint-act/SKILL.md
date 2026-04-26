---
name: sw:lint-act
description: "执行 lint 维度检查，处理 issues，每维度即时保存"
user-invocable: false
context: fork
agent: wiki-maintainer
---

执行所有 pending 维度的 lint 检查。由 `sw:lint` 编排器通过 Skill tool 调用。

## 执行流程

### 1. 读取上下文

读取 wiki.lint.json：
- 获取 pending 维度列表（值为 "pending" 的 dimensions 键）
- 获取 scope（非空则定向扫描）
- 获取已有 findings（追加模式）

### 2. issues 消费（维度检查前执行）

使用 query-wiki.js 查找有 issues 的页面：

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/query-wiki.js --dir docs/wiki --field issues --not-empty
```

对每个有 issues 的页面，逐个验证：
- **源码可验证** → 修复并清除 issue
- **需要用户判断** → 升级为 finding（fixType: content）
- **问题已不存在** → 直接清除 issue

修复时遵循修改协议：读 guidelines → 修复 → 更新 updated。

### 3. 维度执行

按以下顺序执行（从低成本到高成本）：

#### freshness（源码路径有效性）

使用 query-wiki.js 获取所有 feature 页面的 source 字段：
```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/query-wiki.js --dir docs/wiki --type feature
```
Glob 验证每个 source 路径是否存在。不存在的标记为 finding：severity: high, fixType: none。

#### coverage（覆盖完整性）

- 扫描所有 wiki 页面文件
- 检查：正文中 `[[dir/name]]` 双链都有对应的实际文件
- 检查：无孤立页面（每个页面至少被一个其他页面或 index.md 引用）
- 缺失的标记为 finding

#### integrity（数据完整性）

使用 query-wiki.js --dump 获取全量 frontmatter：
```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/query-wiki.js --dir docs/wiki --dump
```
检查：
- 每个页面 frontmatter 必需字段完整
- depends 和类型命名字段的双链格式正确
- 无遗留的旧格式字段（type、related）

#### consistency（内容一致性）

- 读取多个页面内容进行交叉比对
- 同一概念在不同页面术语一致
- 页面内容匹配其层级（如 flow 页面不应描述单 feature 的内部实现）
- 这个维度成本最高，需要读多个页面完整内容

### 4. 保存步骤

每完成一个维度：

1. 标记该维度为 completed
2. 追加 findings 到 wiki.lint.json
3. 每条 finding 包含：
   - `dimension`: 维度名
   - `severity`: high / medium / low
   - `page`: 涉及的页面相对路径
   - `description`: 问题描述
   - `fixType`: safe / content / none
   - `fixPlan`: 修复方案（如有）
4. safe 类型直接修复（更新页面内容和 frontmatter）
5. 保存 wiki.lint.json

### 5. 即时保存

每完成一个维度后，立即保存 wiki.lint.json。确保已完成维度的结果持久化，即使后续被强制终止也不丢失。

### 6. 返回摘要

```
## Lint 维度检查摘要

### 已完成维度
- freshness: X finding(s), Y safe 修复
- coverage: X finding(s)

### issues 处理
- 已修复：N 个
- 已清除：N 个
- 升级为 finding：N 个
```
