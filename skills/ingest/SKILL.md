---
name: sw:ingest
description: "增量同步 wiki 与源码变更。编排器模式：检测变更、构建影响图、逐 target 委派处理"
user-invocable: true
disable-model-invocation: true
---

REACT 编排器——增量同步源码变更到 wiki。

## 前置步骤

读取 `${CLAUDE_PLUGIN_ROOT}/agents/wiki-maintainer.md` 加载共享规则。

## 前置校验

读取 `docs/wiki/wiki.json`：

- **不存在** → 报错："wiki 尚未初始化。请先运行 `/sw:init` 进行全量分析。"
- **`process.phase == "ingesting"`** → 中断恢复，跳到 Loop 阶段
- **`process.phase` 为其他非 completed 值** → 提示："另一个操作正在进行中（{phase}）。请先完成。"
- **`process.phase == "completed"`** → 新 ingest，继续 Detect

## Detect 阶段

### 1. 检测源码变化

```
git log -1 --format=%H -- docs/wiki/wiki.json
  │
  ├─ 找到 commit →
  │   ├─ git diff <commit>..HEAD --diff-filter=R --name-status -- . ':!docs/wiki/'
  │   │   └─ 提取重命名对（R100  old_path  new_path）
  │   ├─ git diff <commit>..HEAD --diff-filter=ACMR --name-only -- . ':!docs/wiki/'
  │   │   ├─ 排除重命名的旧路径
  │   │   └─ 有变更 → 继续构建影响图
  │   └─ 都为空 → 提示"wiki 已是最新"，终止
  │
  ├─ 未找到 → 提示"请先 commit wiki 文件后重试"
  └─ 非 git → 报错"ingest 要求项目使用 git"
```

### 2. 影响分析（两级）

消费 wiki.json 全量关系数据：

**direct（直接影响）**：变更文件命中 `features[X].source` → 该 feature 是 direct target

**indirect（间接影响）**：
- direct target 所属模块出现在 `flows[X].modules` 中 → 该 flow 是 indirect target
- 变更模块被其他页面 `related` 引用 → 检查是否需要更新

对每个 target 记录 `id`、`type`、`status: "pending"`。

变更文件无对应 feature 时：判断是否新 feature → 加入 direct targets，否则归入最近的已有 feature。

### 3. 写入 wiki.json

```json
{
  "process": {
    "phase": "ingesting",
    "anchor": "<commit-hash>",
    "targets": [
      {"id": "login", "type": "direct", "status": "pending"},
      {"id": "auth-flow", "type": "indirect", "reason": "涉及 auth 模块", "status": "pending"}
    ]
  }
}
```

### 4. 检查点 — 用户确认

AskUserQuestion 展示影响分析：

> **增量同步影响分析**
>
> **变更文件**：X 个文件（来自 N 个 commit）
> **Git anchor**：abc123 → def456
>
> ### 直接受影响（将更新）
> - features/login.md（源码文件变更）
>
> ### 间接影响（将检查更新）
> - flows/auth-flow.md ← 涉及 auth 模块
>
> 是否继续处理？

## Loop 阶段

Loop 开始时读 wiki.json 一次获取 targets。

```
loop:
  1. 从 targets 取下一个 pending target
  2. Skill tool 调用 sw:ingest-act {target-id}
  3. Grep wiki.json 搜索该 target 的 "status": "completed" 确认完成
  4. 记录 act 返回的极简摘要（每个 target 一行）
  5. 继续下一个 pending target
  6. 异常时 Read wiki.json 评估状态
```

## Summary 阶段

### 1. 重建报告

读 wiki.json targets，按 type 分组：

```
## 增量同步完成

### 直接受影响（已更新）
- features/login.md
  → 更新：状态枚举新增 CONNECTING

### 间接影响（已处理）
- flows/auth-flow.md ← 涉及 auth 模块
  → 按 guideline 更新 / 基于源码更新
```

### 2. 清理 wiki.json

process 最小化为 `{phase: "completed"}`，revision +1，更新 lastUpdated。

### 3. 追加 log.md

按格式追加变更日志：变更文件列表、更新/新建/删除的页面、关键发现、标注矛盾的页面。

### 4. 建议后续

- 人工审查标注的页面
- 为反复出现矛盾的页面补充 guidelines
- 运行 `/sw:lint` 进行健康检查
- 下次变更后继续使用 `/sw:ingest`
