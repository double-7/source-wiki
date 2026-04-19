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

- `agents/wiki-maintainer.md` — 知识库规则定义（知识模型、页面格式、修改协议、修复边界、wiki.json 数据模式）
- `skills/` — 四条命令的实现：init（全量）、ingest（增量）、lint（检查）、query（查询）
- `skills/init-act-plan/fill/refine`、`skills/ingest-act`、`skills/lint-act` — REACT act，在 fork 上下文中自主执行
- `templates/` — 页面模板，agent 创建 wiki 页面时按需读取
- `.claude-plugin/plugin.json` — 插件清单

规则只在 `agents/wiki-maintainer.md` 中定义，命令实现只在各 `SKILL.md` 中定义。

### REACT 编排模式

init、ingest、lint 共享编排模式（具体实现见各 SKILL.md）：

1. 编排器通过 Skill tool 调用 act，act 在 fork 上下文中自包含执行
2. 编排器用 Grep 轻量确认 act 完成，不 Read 全文件
3. 容量不足时保存进度退出，用户再次运行同一命令从断点继续
4. 完成后 process 最小化为 `{phase: "completed"}`，revision +1，追加 log.md

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
- 多个 SKILL.md 间的小量重复（~5 句）可接受，不抽取为共享 scheme
- 模板中引用路径用 `${CLAUDE_PLUGIN_ROOT}/templates/`（运行时变量）
- Wiki 输出路径固定为 `docs/wiki/`（相对于被分析的目标项目）
- 模板文件中 `type` 字段已统一为 `module | feature | flow | query | architecture`
