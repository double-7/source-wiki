---
name: sw:lint
description: "对 wiki 知识库进行健康检查。编排器模式：规划维度、逐维度委派检查、汇总报告"
user-invocable: true
disable-model-invocation: true
---

REACT 编排器——对 wiki 知识库进行全面健康检查。

## ★ 前置步骤 — 加载规则

```
${CLAUDE_PLUGIN_ROOT}/agents/wiki-maintainer.md
```

## 前置校验

读取 `docs/wiki/wiki.json`：

- **不存在** → 报错："wiki 尚未初始化。请先运行 `/sw:init` 进行全量分析。"
- **`process.phase == "linting"`** → 中断恢复，跳到 Loop 阶段
- **`process.phase` 为其他非 completed 值** → 提示："另一个操作正在进行中（当前阶段：{process.phase}）。请先完成该操作。"
- **`process.phase == "completed"`** → 新 lint，继续 Detect 阶段

## Detect 阶段 — 规划检查范围

### 1. 读取 wiki 状态

读取 `wiki.json` 的 `modules`、`features`、`flows` 规划检查范围。

### 2. 生成检查清单

八个检查维度：

| 维度名 | 检查内容 |
|--------|---------|
| `consistency` | 不同页面之间是否有矛盾的说法 |
| `orphanPages` | 哪些页面没有被任何其他页面引用（入站链接为 0） |
| `missingPages` | 正文中提到的 `[[双链]]` 是否都有对应的实际文件 |
| `dataGaps` | 哪些重要模块/功能/流程还没有被文档化 |
| `staleInfo` | frontmatter 中的 `source` 路径和 `features[X].source` 是否都指向有效文件 |
| `crossReferences` | 有关系的页面是否互相引用了对方 |
| `moduleAttribution` | 每个 feature 页面的 `module` 字段是否指向存在的模块页面，`features[X].module` 是否对应 `modules` 中的条目 |
| `hierarchyCorrectness` | 页面内容是否匹配其所在层级（如 flow 页面不应描述单个 feature 的内部实现） |

### 3. 写入 wiki.json

```json
{
  "process": {
    "phase": "linting",
    "lint": {
      "dimensions": {
        "consistency": "pending",
        "orphanPages": "pending",
        "missingPages": "pending",
        "dataGaps": "pending",
        "staleInfo": "pending",
        "crossReferences": "pending",
        "moduleAttribution": "pending",
        "hierarchyCorrectness": "pending"
      },
      "findings": []
    }
  }
}
```

无需检查点（lint 是只读检查，低风险）。

## Loop 阶段 — 轮次委派

### 编排流程

**轮次循环**——编排器持续调用 lint-act 直到所有维度完成：

1. 读取 `wiki.json` 的 `process.lint.dimensions`，获取 pending 维度列表
2. 如果全部 completed → 进入 Report 阶段
3. 使用 Skill tool 调用 `sw:lint-act`（无维度参数，lint-act 自主处理所有 pending 维度）
4. 轻量确认：Grep wiki.json 检查是否仍有 pending 维度
5. 记录 act 返回的摘要
6. 如果仍有 pending → 回到步骤 1，再次调用 lint-act
7. 如果全部 completed → 进入 Report 阶段

lint-act 在容量不足时会保存已完成的维度进度并退出，编排器只需继续调用即可。

## Report 阶段 — 汇总报告

### 1. 读取检查结果

读取 `wiki.json` 的 `process.lint.findings` 重建完整报告。

### 2. 按 fixType 分组

将 findings 分为三组：
- **safe（已修复）**：lint-act 已直接执行，报告中标注"已修复"
- **content（待确认）**：需要用户确认的内容修复方案
- **none（仅报告）**：无法自动修复的问题

### 3. 输出结构化报告

按照 `${CLAUDE_PLUGIN_ROOT}/templates/lint-report.md` 模板格式输出。报告必须覆盖所有八个检查维度，并建议下一步应摄取哪些源码来填补缺口。

报告中 safe 类型的发现标注"已修复 ✓"。

### 4. 内容修复确认

如果 findings 中有 `fixType: "content"` 的问题，使用 AskUserQuestion 展示修复方案供用户逐项确认：

```
以下内容修复方案待确认：

1. [consistency] user-login.md: "三状态" → "四状态"
   方案：更新状态描述与 module 页面一致

2. [hierarchyCorrectness] order-processing.md: 页面过于臃肿（描述了 3 个独立能力）
   方案：拆分为 order-create.md、order-track.md、order-cancel.md

是否执行这些修复？
```

选项：
- "全部执行" — 执行所有内容修复
- "逐项选择" — 逐个确认每个修复（可跳过单个）
- "跳过" — 不执行内容修复

如果用户确认修复：
- 执行对应的修复操作（页面拆分/合并、内容重写、补充空洞页面等）
- 更新 `wiki.json`：`revision` +1，如涉及页面增删则同步更新 `features`/`modules` 条目
- 修复后更新页面的 `updated` 日期和 `guidelines`（如适用）

### 5. 清理 wiki.json

将 `process` 最小化为 `{phase: "completed"}`，`revision` +1，更新 `lastUpdated`。

### 6. 追加 log.md

按格式追加变更日志，包含：
- 检查的维度和结果摘要
- 发现的问题数量和严重程度
- 安全修复（已自动执行）的问题列表
- 内容修复（用户确认后执行）的问题列表
- 建议的后续步骤
