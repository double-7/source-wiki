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

Glob `docs/wiki/wiki.*.json`：

| 状态 | 动作 |
|------|------|
| 有 wiki.init.json | 中断恢复（AskUserQuestion 三选项：恢复/保留重建/完全重来） |
| 有其他 wiki.*.json | 拒绝："另一个操作正在进行中。请先完成。" |
| 有 wiki 页面但无临时文件 | AskUserQuestion：重新全量分析（覆盖）还是用 `/sw:ingest` 增量？ |
| 空目录 | 执行阶段一（扫描规划） |

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

### 3. 创建 wiki.init.json

```json
{
  "pending": ["<所有模块名>"],
  "completed": [],
  "plan": {
    "<模块名>": {
      "source": "src/auth/",
      "features": ["login", "register"]
    }
  }
}
```

### 4. 检查点 — 用户确认

AskUserQuestion 展示模块划分方案：

> **模块划分方案**：
> - auth (src/auth/, ~12 files) → features: login, register, token-refresh
> - order (src/order/, ~8 files) → features: create, track
>
> **处理顺序**：auth → order → payment（按依赖关系从底层到上层）
>
> 此划分是否合理？可以调整模块的合并、拆分或重命名。

用户确认后：如需调整则更新 wiki.init.json，进入阶段二。

## 阶段二：逐模块委派

### 编排流程

读取 wiki.init.json 获取 pending 列表。按顺序逐个处理：

```
loop:
  1. Skill tool 调用 sw:init-act {模块名}
  2. Grep wiki.init.json 确认该模块已移至 completed
     - 确认成功 → 继续下一个
     - 确认失败 → 进入 catch
  3. 每完成 2-3 个模块输出简要进度（不暂停等待）

catch:
  1. 重试：重新派发 init-act（fork 获得新上下文）
  2. 再次 Grep 确认
     - 成功 → 继续下一个
     - 仍失败 → Edit 从 pending 移除该模块，记录为跳过，继续下一个
```

只有当 act 返回异常时，才 Read wiki.init.json 评估状态。

### 全部模块完成

pending 为空，进入阶段三收尾。

## 阶段三：收尾

编排器直接执行全局性收尾工作。

### 1. 创建 flow 页面

根据各 act 返回摘要中的跨模块关系线索，创建跨模块业务流程页面（参考 `${CLAUDE_PLUGIN_ROOT}/templates/flow.md`）。

### 2. 完善 overview.md

补充（参考 `${CLAUDE_PLUGIN_ROOT}/templates/overview.md`）：
- 架构概览和系统分层
- 模块间关系
- 关键设计决策
- 技术栈详情

### 3. 创建 index.md、log.md、.gitignore

- **index.md**：完整版导航，包含所有已创建的页面双链引用
- **log.md**：初始条目（格式见 wiki-maintainer.md 日志格式）
- **.gitignore**：处理排除 wiki.*.json：
  - 不存在 → 创建，内容为 `wiki.*.json`
  - 已存在且不含该规则 → 追加
  - 已存在且已含该规则 → 跳过

### 4. 清理

删除 `docs/wiki/wiki.init.json`。

### 5. 更新 index.md.updated

将 index.md 的 `updated` 字段更新为当前秒级 ISO 时间戳（与 log.md 写入同步）。

### 6. 完成摘要

输出：
- **模块划分**：最终版与初始提案的差异（如有）
- **创建的页面清单**
- **关键发现**（汇总各模块摘要）
- **低置信度区域**：标记供用户重点审查

建议：
- 运行 `/sw:lint` 进行健康检查
- 人工审查低置信度页面
- 后续源码变更时使用 `/sw:ingest` 增量同步
