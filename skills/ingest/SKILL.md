---
name: sw:ingest
description: "增量同步 wiki 与源码变更。编排器模式：检测变更、构建影响图、逐 target 委派处理"
user-invocable: true
disable-model-invocation: true
---

REACT 编排器——增量同步源码变更到 wiki。

## ★ 前置步骤 — 加载规则

**在执行任何操作之前，必须先读取以下文件获取所有共享规则：**

```
${CLAUDE_PLUGIN_ROOT}/agents/wiki-maintainer.md
```

此文件定义了 wiki 的层级体系、目录结构、页面格式约定、Feature 粒度规则、wiki.json 格式等所有规则。

## 前置校验

读取 `docs/wiki/wiki.json`：

- **不存在** → 报错："wiki 尚未初始化。请先运行 `/sw:init` 进行全量分析。"
- **`process.phase == "ingesting"`** → 中断恢复，跳到 Loop 阶段
- **`process.phase` 为其他非 completed 值** → 提示："另一个操作正在进行中（当前阶段：{process.phase}）。请先完成该操作。"
- **`process.phase == "completed"`** → 新 ingest，继续 Detect 阶段

## Detect 阶段 — 检测变更与影响图

### 1. 检测源码变化

```
源码变化检测
  │
  ├─ 源码仓库是 git？
  │   │
  │   ├─ 是：执行 git log -1 --format=%H -- docs/wiki/wiki.json
  │   │   │
  │   │   ├─ 找到 commit →
  │   │   │   │
  │   │   │   ├─ 第一步：git diff <commit>..HEAD --diff-filter=R --name-status -- . ':!docs/wiki/'
  │   │   │   │   │
  │   │   │   │   └─ 提取重命名对（R100  old_path  new_path）
  │   │   │   │
  │   │   │   ├─ 第二步：git diff <commit>..HEAD --diff-filter=ACMR --name-only -- . ':!docs/wiki/'
  │   │   │   │   │
  │   │   │   │   ├─ 排除重命名的旧路径（已作为 rename 处理）
  │   │   │   │   │
  │   │   │   │   ├─ 有变更文件 → 继续构建影响图
  │   │   │   │   └─ 无变更 → 仅重命名时，也继续构建影响图
  │   │   │   │
  │   │   │   └─ 重命名 + 变更都为空 → 提示"wiki 已是最新"，终止
  │   │   │
  │   │   └─ 未找到（wiki.json 从未 commit）→ 提示用户先 commit wiki 文件，然后重试
  │   │
  │   └─ 否：报错"ingest 要求项目使用 git 进行变更检测。非 git 项目请使用 /sw:init 重新全量分析。"
  │
  └─ 全部失败 → 建议执行 /sw:init 全量分析
```

### 2. 构建影响图

消费 wiki.json 全量关系数据，分五级映射变更：

1. **重命名处理（type: "rename"）**：重命名的旧路径命中 `features[X].source` → 该 feature 是 rename target，`reason` 标注 `old_path → new_path`。ingest-act 执行时更新 feature 的 source 路径和 frontmatter，不需要重读源码
2. **直接影响（type: "direct"）**：变更文件命中 `features[X].source` → 该 feature 是直接 target
2. **关联影响（type: "correlated"）**：直接 target 所属模块的 `exports` 中有符号被其他 features 的 `imports` 引用 → 这些 features 是关联 target，`reason` 标注具体引用关系
3. **流程影响（type: "flow"）**：直接 target 所属模块出现在 `flows[X].modules` 中 → 该 flow 是流程 target
4. **约定影响（type: "convention"）**：直接 target 所属模块有 `conventions` → 生成约定验证 target

对每个 target，记录 `id`（feature/flow 名）、`type`、`status: "pending"`。correlated/flow/convention 类型额外记录 `reason`。

变更文件无对应 feature 时：判断是否为新 feature → 加入 targets（type: "direct"），否则归入最近的已有 feature。

### 3. 写入 wiki.json

将完整 targets 清单和 anchor 写入 wiki.json：

```json
{
  "process": {
    "phase": "ingesting",
    "ingest": {
      "anchor": "<commit-hash>",
      "targets": [<上面构建的 targets 清单>]
    }
  }
}
```

### 4. 检查点 — 用户确认

使用 AskUserQuestion 展示影响分析结果，请求用户确认：

```
问题："以上是增量同步的影响分析，共 X 个目标。是否继续处理？"
选项：
  - "继续处理" — 开始逐 target 更新
  - "取消" — 终止本次 ingest
  - （如涉及 3+ 模块）"范围较大，改为全量 /sw:init" — 终止并建议全量分析
```

AskUserQuestion 的 `question` 字段中展示完整影响分析：

```markdown
## 增量同步影响分析

**变更文件**：X 个文件（来自 N 个 commit）
**Git anchor**：abc123 → def456

### 文件重命名（将更新路径）
- features/tcp-api-protocol.md ← src/protocol/OldName.java → src/protocol/NewName.java

### 直接受影响（将更新）
- features/tcp-api-protocol.md（源码文件变更）

### 关联影响（将按 guidelines 尝试更新）
- features/sdk-connection-lifecycle.md
  ← imports JChannelState（protocol 模块导出，已变更）

### 流程影响（将按 guidelines 尝试更新）
- flows/file-sync-flow.md ← 涉及 protocol 模块（已变更）

### 约定验证
- protocol: "MTU 等长对齐" → 待验证

### Guidelines 提示
目标页面中已配置 guidelines 的将按约定原则更新，未配置的将基于源码直接更新。
```

用户确认后进入 Loop 阶段。

## Loop 阶段 — 逐 target 委派

### 编排流程

**Loop 开始时**读取 `wiki.json` 一次，获取完整的 `process.ingest.targets` 列表。后续循环中不再重读完整 wiki.json。

1. **调用 act**：使用 Skill tool 调用 `sw:ingest-act`，参数为 target 的 id
2. **轻量确认**：使用 `Grep` 在 wiki.json 中搜索该 target id 的 `"status": "completed"` 确认完成（而非 `Read` 全文件）
3. **记录摘要**：记录 act 返回的极简摘要（每个 target 一行）
4. **继续下一个**：按初始读取的 targets 列表顺序继续下一个 pending target
5. **异常处理**：只有当 act 返回异常时，才重新 `Read` wiki.json 评估后续状态

### 容量检查

每完成一个 target 后评估：
- 如果感觉剩余容量不足（已处理超过 15 个 target，或对话已经很长）→ 退出循环，提示："已完成 X/Y 个目标。再次运行 `/sw:ingest` 继续处理剩余目标。"
- 否则 → 继续下一个 target

## Summary 阶段 — 汇总报告

### 1. 重建完整报告

读取 `wiki.json` 的 `process.ingest.targets`，按 type 分组生成结构化摘要：

```
## 增量同步完成

### 文件重命名（已更新路径）
- features/tcp-api-protocol.md
  ← src/protocol/OldName.java → src/protocol/NewName.java

### 直接受影响（已更新）
- features/tcp-api-protocol.md
  → 更新：状态枚举新增 CONNECTING
  → ⚠️ 矛盾：旧文档描述"三状态"，代码已改为四状态（已更新）

### 关联影响（已处理）
- features/sdk-connection-lifecycle.md
  ← imports JChannelState（protocol 模块导出，已变更）
  → 按 guideline 更新 / 基于源码更新（信息不足时标注审查建议）

### 流程影响（已处理）
- flows/file-sync-flow.md ← 涉及 protocol 模块（已变更）
  → 按 guideline 更新 / 基于源码更新（信息不足时标注审查建议）

### 约定验证
- protocol: "MTU 等长对齐" → ✓ 仍成立
```

### 2. 清理 wiki.json

将 `process` 最小化为 `{phase: "completed"}`，`revision` +1，更新 `lastUpdated`。

### 3. 追加 log.md

按格式追加变更日志，包含：
- 变更文件列表
- 更新的页面、新建的页面、删除的页面
- 关键发现
- 标注 ⚠️ 的矛盾或约定失效

### 4. 建议后续

- 人工审查 ⚠️ 标注的页面
- 为反复出现矛盾的页面补充 guidelines，避免后续被覆盖
- 运行 `/sw:lint` 进行健康检查
- 下次变更后继续使用 `/sw:ingest` 增量同步
