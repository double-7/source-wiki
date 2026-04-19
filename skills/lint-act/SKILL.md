---
name: sw:lint-act
description: "执行 lint 维度检查，处理 issues，到容量上限自动保存退出"
user-invocable: false
context: fork
agent: wiki-maintainer
---

执行所有 pending 维度的 lint 检查。由 `sw:lint` 编排器通过 Skill tool 调用。

## 执行流程

### 1. 读取上下文

读取 wiki.json：
- 获取 pending 维度列表
- 获取 scope（非空则定向扫描）

### 2. issues 消费（维度检查前执行）

扫描范围内每个页面的 frontmatter `issues`，逐个验证：

- **源码可验证** → 修复并清除 issue
- **需要用户判断** → 升级为 finding（fixType: content）
- **问题已不存在** → 直接清除 issue

修复时遵循修改协议：读 guidelines → 修复 → 更新 updated → revision +1。

### 3. 维度执行

按以下顺序执行（从低成本到高成本）：

#### freshness（源码路径有效性）

- Glob 验证 wiki.json 中所有 modules[X].source 是否指向存在的目录
- Glob 验证所有 features[X].source 中的路径是否存在
- 不存在的标记为 finding：severity: high, fixType: none, description: 说明哪个路径无效

#### coverage（覆盖完整性）

- 扫描所有 wiki 页面文件列表
- 检查：modules 中注册的都有页面文件
- 检查：无孤立页面（每个页面至少被一个其他页面或 index.md 引用）
- 检查：正文中 `[[双链]]` 都有对应的实际文件
- 缺失的标记为 finding

#### integrity（数据一致性）

- 对比 wiki.json 与实际文件
- wiki.json 中注册的页面文件都存在
- 实际 wiki 文件都在 wiki.json 中有注册（modules/features/flows 中有对应条目）
- frontmatter 必需字段完整（title、type、created、updated、source）
- feature 页面的 module 字段指向存在的模块

#### consistency（内容一致性）

- 读取多个页面内容进行交叉比对
- 同一概念在不同页面术语一致
- 页面内容匹配其 type 层级（如 flow 页面不应描述单 feature 的内部实现）
- 这个维度成本最高，需要读多个页面完整内容

### 4. 保存步骤

每完成一个维度：

1. 标记维度为 completed
2. 追加 findings 到 wiki.json process.lint.findings
3. 每条 finding 包含：
   - `dimension`: 维度名
   - `severity`: high / medium / low
   - `page`: 涉及的页面路径
   - `description`: 问题描述
   - `fixType`: safe / content / none
   - `fixPlan`: 修复方案（如有）
4. safe 类型直接修复（更新页面内容、frontmatter、wiki.json）
5. 保存 wiki.json

### 5. 容量检查

每完成一个维度后评估。容量不足 → 保存已完成的维度进度，退出。

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
