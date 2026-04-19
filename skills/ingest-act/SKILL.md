---
name: sw:ingest-act
description: "处理单个 ingest target，按修复边界决策更新或记录"
user-invocable: false
context: fork
agent: wiki-maintainer
---

处理单个 ingest target。由 `sw:ingest` 编排器通过 Skill tool 调用。

Target ID: $ARGUMENTS

## 获取上下文

1. 读取 `docs/wiki/wiki.json`
2. 从 `process.targets` 中找到 `id == $ARGUMENTS` 的 target
3. 获取 target 的 `type`、`status`（必须为 pending）、`reason`（如有）
4. 读取目标页面的 frontmatter `guidelines` 和 `issues`（如果页面存在）

如果 target 不存在或已 completed → 报错退出。

## 按 type 执行

### type == "direct"（源码文件变更命中 feature）

1. 读取目标 feature wiki 页面 + 源码 Tier 1 签名
2. 对比分析：
   - 有结构变化（新增/删除文件、新增/删除导出）→ 更新页面
   - 新旧矛盾（描述与代码不一致）→ 检查 guidelines 后决定：有 guideline 按原则更新，无 guideline 基于源码更新
   - 无变化 → 跳过
3. 特殊情况：
   - 新增文件无法归属现有 feature → 创建新 feature 页面
   - 删除文件导致 feature 无源码 → 删除 feature 页面

### type == "indirect"（跨模块关联影响）

1. 读取目标页面 + 相关源码（如 reason 提到的变更模块）
2. 按修复边界决策：
   - 机械性变更（import 路径更新、符号重命名）→ 自动修
   - 语义变更需理解上下文 → 读 guidelines 后修改
   - 信息不足或需全局判断 → 写 issues 到 frontmatter

## 更新 wiki.json

- target status 改为 completed
- 同步 features 变更（如新建/删除 feature）
- revision +1，更新 lastUpdated

## 返回极简摘要

```
{target-id}: {更新|跳过|写issues} — 一句话说明
```
