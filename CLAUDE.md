# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目性质

这是一个 Claude Code 插件项目（非应用/库）。项目内容全部为 Markdown/YAML/JSON 声明式配置，无构建系统、无测试框架、无包管理器。

插件名称：`source-wiki`，将源码快速映射为结构化 wiki 知识库。利用大模型加速处理，推动知识持续积累与复用；人负责审核校正，保持专注与方向。

### 产品定位

1. **快速搭建统一骨架**：通过 `/sw:init` 交互式生成结构化 wiki，带用户确认检查点
2. **持续更新**：通过 `/sw:ingest` 增量同步和 `/sw:lint` 健康检查保持 wiki 与源码同步
3. **知识查询**：通过 `/sw:query` 基于已有 wiki 回答问题，有价值的分析沉淀为新页面

LLM 生成的 wiki 天然存在准确率上限（隐式约定、复杂控制流、设计意图推理等），因此插件的设计决策应优先考虑：
- **结构一致性** > 内容完美度：骨架正确比细节准确更重要，细节由人校正
- **可校正性** > 自洽性：生成的内容应该易于人类定位和修改，而不是追求机器自洽
- **增量改进** > 一次性完美：支持反复 `/init` + `/ingest` + `/lint` 逐步提升质量

## 架构

三个层面：

- **产品层**：init/ingest/lint/query 四维度定义 wiki 生命周期
- **架构层**：数据模型 + 临时状态管理 + 安全机制
- **实现层**：agent 定义 WHAT（规则、模型、约束），skills 定义 HOW（执行流程）

### 文件结构

- `agents/wiki-maintainer.md` — 纯 WHAT：知识模型、frontmatter schema、页面格式、临时文件规范、共享不变量
- `skills/` — 纯 HOW：7 个 SKILL.md（4 编排器 + 3 act）
  - `init/SKILL.md` — 编排器：扫描规划 → 逐模块委派 → 收尾
  - `init-act/SKILL.md` — act：分析单个模块源码，创建 wiki 页面
  - `ingest/SKILL.md` — 编排器：变更检测 → 影响分析 → 逐 target 委派
  - `ingest-act/SKILL.md` — act：处理单个变更目标
  - `lint/SKILL.md` — 编排器：规划维度 → 委派检查 → 汇总报告
  - `lint-act/SKILL.md` — act：执行维度检查（freshness/coverage/consistency/integrity）
  - `query/SKILL.md` — 直接执行，无 REACT
- `templates/` — 5 个页面模板（index、overview、module、feature、flow）
- `hooks/wiki-hook.js` — 统一校验（临时文件 schema + frontmatter 按目录校验）
- `scripts/query-wiki.js` — frontmatter 结构化查询脚本
- `libs/js-yaml-4.1.1.min.js` — 内嵌 YAML 解析库（MIT）
- `.claude-plugin/plugin.json` — 插件清单

### REACT 编排模式

init、ingest、lint 共享编排模式（具体实现见各 SKILL.md）：

1. 编排器通过 Skill tool 调用 act，act 在 fork 上下文中自包含执行
2. 编排器用 Grep 轻量确认 act 完成，不 Read 全文件
3. act 确认失败时重试 1 次（fork 新上下文）；仍失败则跳过该项继续，最终报告跳过列表
4. 完成后删除临时文件，编排器更新 index.md + 追加 log.md

query 不使用此模式，直接在用户会话中执行。

## 测试

用 `claude --plugin-dir ./` 启动开发模式，在另一个测试项目上执行 `/sw:init src/` 验证生成结果。

## 提交风格

使用 Conventional Commits：
- `feat:` 新功能
- `refactor:` 重构
- `fix:` 修复
- `docs:` 文档变更
- `chore:` 杂项

## 注意事项

- 修改 wiki-maintainer.md 时只添加规则/格式/约束（WHAT），执行流程/状态转换（HOW）放对应 SKILL.md
- 临时文件 schema（wiki.init.json、wiki.ingest.json、wiki.lint.json）在设计文档统一定义，SKILL.md 直接引用
- 多个 SKILL.md 间的小量重复（~5 句）可接受，不抽取为共享 scheme
- 模板中引用路径用 `${CLAUDE_PLUGIN_ROOT}/templates/`（运行时变量）
- Wiki 输出路径固定为 `docs/wiki/`（相对于被分析的目标项目）
- 页面类型由文件所在目录确定，模板中不含 `type` 字段
- agent（含 fork act）无法检测自身剩余上下文或 maxTurns，编排指令不能依赖"容量检测后再保存"
