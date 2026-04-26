---
name: sw:ingest
description: "增量同步 wiki 与源码变更。编排器模式：检测变更、构建影响图、逐 target 委派处理"
user-invocable: true
disable-model-invocation: true
---

REACT 编排器——增量同步源码变更到 wiki。

## 前置步骤

读取 `${CLAUDE_PLUGIN_ROOT}/agents/wiki-maintainer.md` 加载共享规则。

## 状态判断

Glob `docs/wiki/wiki.*.json`：

| 状态 | 动作 |
|------|------|
| 有 wiki.ingest.json | 中断恢复（AskUserQuestion 三选项：恢复/保留重建/完全重来） |
| 有其他 wiki.*.json | 拒绝："另一个操作正在进行中。请先完成。" |
| 无临时文件 | 确认 docs/wiki/ 存在且有页面 → 继续 Detect；不存在 → 报错"请先运行 `/sw:init`" |

## Detect 阶段

### 1. 锚点检测

按以下顺序获取 git diff 基准点：

```
git log -1 --format=%H -- docs/wiki/log.md
  │
  ├─ 找到 commit hash → 使用该 hash
  │
  ├─ 无返回（未 commit 过） →
  │   git log -1 --format=%H
  │     ├─ 有 HEAD → 使用 HEAD，执行 diff 到工作区
  │     └─ 空（空仓库）→ 报告"wiki 刚初始化，尚无源码变更可同步"，正常退出
  │
  └─ 非 git 仓库 → 报错"ingest 要求项目使用 git"
```

### 2. 检测源码变化

```
git diff <hash>..HEAD -- <source-dir> -- ':!docs/wiki/'
```

提取变更文件列表。无变更 → 提示"wiki 已是最新"，终止。

### 3. 影响分析（两级）

使用 `query-wiki.js` 进行结构化查询：

**direct（直接影响）**：对每个变更文件执行查询
```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/query-wiki.js --dir docs/wiki --type feature --field source --contains <file>
```
命中 → 该 feature 是 direct target

**indirect（间接影响）**：
- direct target 所属 module：
  ```bash
  node ${CLAUDE_PLUGIN_ROOT}/scripts/query-wiki.js --dir docs/wiki --type module --field features --contains "[[features/X]]"
  ```
- module 涉及的 flow：
  ```bash
  node ${CLAUDE_PLUGIN_ROOT}/scripts/query-wiki.js --dir docs/wiki --type flow --field modules --contains "[[modules/X]]"
  ```

对每个 target 记录 `id`、`type`（direct/indirect）、`reason`。

变更文件无对应 feature 时：判断是否新 feature → 加入 direct targets，否则归入最近的已有 feature。

### 4. 创建 wiki.ingest.json

```json
{
  "anchor": "<commit-hash>",
  "changedFiles": ["src/auth/LoginService.kt"],
  "pending": [
    {"id": "login", "type": "direct", "reason": "src/auth/LoginService.kt modified"}
  ],
  "completed": []
}
```

### 5. 检查点 — 用户确认

AskUserQuestion 展示影响分析：

> **增量同步影响分析**
>
> **变更文件**：X 个文件（anchor: abc123 → HEAD）
>
> ### 直接受影响（将更新）
> - features/login.md（src/auth/LoginService.kt 变更）
>
> ### 间接影响（将检查）
> - flows/auth-flow.md ← 涉及 auth 模块
>
> 是否继续处理？

## Loop 阶段

读取 wiki.ingest.json 获取 pending 列表。

```
loop:
  1. 从 pending 取下一个 target
  2. Skill tool 调用 sw:ingest-act {target-id}
  3. Grep wiki.ingest.json 搜索该 target 确认已在 completed 中
     - 确认成功 → 记录极简摘要，继续下一个
     - 确认失败 → 进入 catch

catch:
  1. 重试：重新派发 ingest-act（fork 获得新上下文）
  2. 再次 Grep 确认
     - 成功 → 记录摘要，继续下一个
     - 仍失败 → Edit 从 pending 移除该 target，记录为跳过，继续下一个
```

## Summary 阶段

### 1. 重建报告

按 type 分组输出：

```
## 增量同步完成

### 直接受影响（已更新）
- features/login.md
  → 更新：状态枚举新增 CONNECTING

### 间接影响（已处理）
- flows/auth-flow.md ← 涉及 auth 模块
  → 基于 guideline 更新
```

### 2. 清理

删除 `docs/wiki/wiki.ingest.json`。

### 3. 更新 index.md.updated + 追加 log.md

- 将 index.md 的 `updated` 更新为当前秒级 ISO 时间戳
- 按格式追加变更日志：变更文件列表、更新/新建/删除的页面、关键发现

### 4. 建议后续

- 人工审查更新的页面
- 运行 `/sw:lint` 进行健康检查
- 下次变更后继续使用 `/sw:ingest`
