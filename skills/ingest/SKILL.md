---
name: sw:ingest
description: "增量同步 wiki 与源码变更。自主运行，通过 git diff 检测变化并更新受影响的 wiki 页面"
argument-hint: "[source-path]"
user-invocable: true
disable-model-invocation: true
context: fork
agent: wiki-maintainer
---

执行增量同步操作——检测源码变更并更新 wiki。

源码路径: $ARGUMENTS

## 前置校验

此操作要求 wiki 已通过 `/sw:init` 完成全量构建。检查 `docs/wiki/wiki.json`：

- **不存在** → 报错："wiki 尚未初始化。请先运行 `/sw:init` 进行全量分析。"
- **存在但 `phase != "completed"`** → 提示："上次全量分析未完成（当前阶段：{phase}）。请先运行 `/sw:init` 完成或恢复。"
- **存在且 `phase == "completed"`** → 继续执行

## 步骤 1 — 检测源码变化

```
源码变化检测
  │
  ├─ 源码仓库是 git？
  │   │
  │   ├─ 是：执行 git log -1 --format=%H -- docs/wiki/wiki.json
  │   │   │
  │   │   ├─ 找到 commit → git diff <commit>..HEAD --name-only -- . ':!docs/wiki/'
  │   │   │   │
  │   │   │   ├─ 有变更文件 → 继续增量更新
  │   │   │   └─ 无变更 → 提示"wiki 已是最新"，终止
  │   │   │
  │   │   └─ 未找到（wiki.json 从未 commit）→ 提示用户先 commit wiki 文件，然后重试
  │   │
  │   └─ 否：提示用户提供变更文件列表
  │
  └─ 全部失败 → 建议执行 /sw:init 全量分析
```

检测到变化后：
- 变化文件涉及 3+ 个模块 → 在结果中建议用户考虑重新执行 `/sw:init`，但继续执行增量更新

## 步骤 2 — 映射变化到 wiki 页面

使用 `wiki.json` 中的 `sourceMap` 做精确匹配：

- 遍历 `sourceMap`，找出 source 文件出现在变更列表中的 wiki 页面
- 变化文件无对应 sourceMap 条目 → 自主判断是否为新 feature：
  - 是 → 创建新页面并在 sourceMap 中注册
  - 否 → 归入最近的已有页面
- 输出：受影响的 wiki 页面清单

## 步骤 3 — 执行增量更新

对每个受影响的页面，按分层阅读策略处理：

| 源码变化场景 | wiki 处理方式 |
|-------------|--------------|
| 源码修改，feature 仍存在 | 先读签名（Tier 1），只有结构变化（新导出、改接口）才更新页面 |
| 新增文件/目录 | 判断归属，创建新 feature 页面或更新已有页面 |
| 删除源码，feature 不再存在 | 删除对应 wiki 页面，清理 index.md 和其他页面中的双链引用 |
| 文件被移动/重命名 | 更新页面的 source 字段和 sourceMap 条目 |

## 步骤 4 — 收尾

- 更新 `index.md` 和受影响的关联页面
- 追加 `log.md`
- 更新 `wiki.json`：更新 `sourceMap`，`revision` +1，更新 `lastUpdated`

## 完成

在控制台输出摘要：变更文件列表、更新的页面、新建的页面、删除的页面。
