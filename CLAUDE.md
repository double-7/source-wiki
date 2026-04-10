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

- `agents/wiki-maintainer.md` — 插件的核心"大脑"，~340 行系统提示词，定义了所有规则和操作流程
- `skills/` — 四个 skill 触发器：init（全量，`context: user` 交互式）、ingest（增量，`context: fork` 自主）、query、lint
- `templates/` — 页面模板，agent 创建 wiki 页面时按需读取
- `.claude-plugin/plugin.json` — 插件清单

规则只在 `agents/wiki-maintainer.md` 中定义一次，不重复到其他文件。

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

- 模板中引用路径用 `${CLAUDE_PLUGIN_ROOT}/templates/`（运行时变量）
- Wiki 输出路径固定为 `docs/wiki/`（相对于被分析的目标项目）
- 模板文件中 `type` 字段已统一为 `module | feature | flow | query | architecture`
