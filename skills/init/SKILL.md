---
name: sw:init
description: "全量分析：扫描源码 → 模块分析 → 收尾。自动检测状态从断点继续"
argument-hint: "[source-path]"
user-invocable: true
disable-model-invocation: true
---

全量初始化——从源码构建完整的 wiki 知识库。

源码路径: $ARGUMENTS

## 前置步骤

读取 `${CLAUDE_PLUGIN_ROOT}/agents/wiki-maintainer.md` 加载共享规则（知识模型、页面格式、修改协议、修复边界）。

## 状态判断

读取 `docs/wiki/wiki.json`：

| 状态 | 动作 |
|------|------|
| 不存在 | 执行阶段一（扫描规划） |
| `process.phase == "init-running"` | 从断点继续（跳到阶段二） |
| `process.phase == "completed"` | AskUserQuestion：重新全量分析（覆盖）还是用 `/sw:ingest` 增量？ |
| 其他 phase | 提示"另一个操作进行中（{phase}），请先完成" |

## 阶段一：扫描规划

编排器直接执行轻量扫描，不需要 fork。

### 1. 扫描源码元数据

按以下顺序操作（只读签名和结构，不读实现）：

1. **目录结构**：Glob 源码目录（depth 3），排除 node_modules/、vendor/、dist/、build/、out/、.git/、docs/wiki/
2. **包管理文件**（选最相关的一个）：Read package.json / pom.xml / go.mod / Cargo.toml / pyproject.toml
3. **README.md**：Read
4. **导出签名**：Grep `export` 语句（签名行，不读文件内容）。超过 200 行匹配时按目录分批
5. **依赖关系**：Grep `import` / `require` 语句（签名行）。只扫入口文件和桶文件（index.ts / mod.ts）
6. **测试文件名**：Glob `*.test.*` / `*.spec.*` / `*_test.*`

### 2. 综合分析

基于扫描结果：
- 确定模块边界（依据：目录结构、export 聚合、import 依赖）
- 为每个模块列出预估的 features、keyFiles
- 确定处理顺序（按依赖关系从底层到上层）
- 对模糊区域标注低置信度

### 3. 创建 wiki 骨架

创建以下文件：

1. **wiki.json**：
```json
{
  "revision": 1,
  "lastUpdated": "<now>",
  "process": {
    "phase": "init-running",
    "queue": ["<所有模块>"],
    "completed": []
  },
  "modules": {
    "<模块名>": {
      "source": "<源码路径>",
      "features": [],
      "page": "docs/wiki/modules/<模块名>.md"
    }
  },
  "features": {},
  "flows": {}
}
```

2. **index.md**：导航骨架（参考 `${CLAUDE_PLUGIN_ROOT}/templates/index.md`）
3. **overview.md**：骨架版（参考 `${CLAUDE_PLUGIN_ROOT}/templates/overview.md`），填入项目名和技术栈
4. **各模块 stub 页面**：仅 frontmatter + 一句话概述（参考 `${CLAUDE_PLUGIN_ROOT}/templates/module.md`）
5. **log.md**：初始条目

### 4. 检查点 — 用户确认

AskUserQuestion 展示模块划分方案：

> **模块划分方案**：
> - auth (src/auth/, ~12 files) → features: login, register, token-refresh
> - order (src/order/, ~8 files) → features: create, track
>
> **处理顺序**：auth → order → payment（按依赖关系从底层到上层）
>
> 此划分是否合理？可以调整模块的合并、拆分或重命名。

用户确认后：如需调整则更新 wiki.json，进入阶段二。

## 阶段二：逐模块委派

### 编排流程

Loop 开始时读 wiki.json 一次，获取 process.queue 和 process.completed。

按 queue 顺序逐个处理：

1. **调用 act**：Skill tool 调用 `sw:init-act`，参数为目标模块名
2. **轻量确认**：Grep wiki.json 搜索该模块名确认已在 completed 中
3. **进度输出**：每完成 2-3 个模块输出简要进度（不暂停等待）
4. **继续下一个**：按初始读取的 queue 列表继续
5. **异常处理**：只有当 act 返回异常时，才 Read wiki.json 评估状态

### 全部模块完成

确认 wiki.json process.phase 已更新为 `"init-finalizing"`。进入阶段三收尾。

## 阶段三：收尾

编排器直接执行全局性收尾工作。

### 1. 创建 flow 页面

根据各 act 返回摘要中的跨模块关系线索，创建跨模块业务流程页面（参考 `${CLAUDE_PLUGIN_ROOT}/templates/flow.md`）。

在 wiki.json 的 flows 中创建对应条目：modules（涉及的模块列表）、page。

### 2. 完善 overview.md

补充（参考 `${CLAUDE_PLUGIN_ROOT}/templates/overview.md`）：
- 架构概览和系统分层
- 模块间关系
- 关键设计决策
- 技术栈详情

### 3. 完善 index.md

完整版导航，包含所有已创建的页面。

### 4. 最终更新

- wiki.json process 最小化为 `{phase: "completed"}`，revision +1，更新 lastUpdated
- 追加 log.md 条目

### 5. 完成摘要

输出：
- **模块划分**：最终版与初始提案的差异（如有）
- **创建的页面清单**
- **关键发现**（汇总各模块摘要）
- **低置信度区域**：标记供用户重点审查

建议：
- 运行 `/sw:lint` 进行健康检查
- 人工审查低置信度页面
- 后续源码变更时使用 `/sw:ingest` 增量同步
