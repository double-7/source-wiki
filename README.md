# source-wiki

将源码快速映射为结构化 wiki 知识库的 Claude Code 插件。利用大模型加速处理，推动知识持续积累与复用；人负责审核校正，保持专注与方向。

灵感源自 Karpathy 的 [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) 模式：与其每次提问都让 LLM 从源码重新检索和推理，不如让 LLM 持续构建和维护一份结构化 wiki——知识编译一次，持续保持更新，而非每次重新推导。

## 核心理念

源码有三个独特属性使这个模式格外有效：**结构可发现**（导出、类型、测试揭示架构）、**真相可验证**（代码始终是权威的）、**变更可追踪**（git 精确检测变化）。

source-wiki 将这种隐性知识转化为显性的、结构化的 wiki 知识库：

- **LLM 负责繁重的维护工作**——扫描源码、提取关键信息、建立交叉引用、检测矛盾、保持一致性。这些工作让人类来做既枯燥又容易遗漏
- **人负责方向和判断**——确认模块划分是否合理、审查 LLM 不确定的区域、决定哪些知识值得深入记录
- **知识持续复利**——每次分析、每次查询沉淀的有价值结论，都让 wiki 变得更完整。新加入的团队成员读 wiki 就能快速理解项目全貌

> 参考Karpathy 对当前项目收拢为 prompt描述 ：[中文版](./Source-Wiki.Ch.md) | [English](./Source-Wiki.En.md)

## 安装

```bash
# 从 GitHub 安装
claude plugin install https://github.com/double-7/source-wiki

# 本地开发模式
claude --plugin-dir /path/to/source-wiki
```

## 使用

四个命令构成 wiki 与源码之间的闭环：

```
  ┌─────────┐                        ┌─────────┐
  │         │── init (首次构建) ────▶│         │───┐
  │  Code   │                        │  Wiki   │   │ lint · query (自检·查询·沉淀)
  │         │── ingest (变更同步) ──▶│         │◀─┘ 
  └────┬────┘                        └────┬────┘
       ▲                                  ▲
       │            人: 审核/修正          │
       └──────────────────────────────────┘
```

**`/sw:init [source-path]`** — 从源码全量构建 wiki 骨架。扫描签名（不读实现），提出模块划分方案经用户确认后，逐模块生成分层页面，最后推断跨模块流程和架构文档。支持中断恢复。

**`/sw:ingest`** — 增量同步源码变更到 wiki。通过 `git diff` 精确检测变更，构建影响图（直接 + 间接），用户确认后逐个更新受影响页面。要求项目使用 git。

**`/sw:lint [module | instruction]`** — wiki 健康检查。四维度扫描（时效性、覆盖度、完整性、一致性），安全修复自动执行，内容变更需用户确认，同时提炼 guidelines 建议。支持定向分析和自然语言指令模式。

**`/sw:query [question]`** — 基于 wiki 回答问题。先查 wiki，不够时回溯源码。有价值的分析可沉淀为新页面，发现矛盾时内联修正。

Wiki 输出目录：`docs/wiki/`

## Wiki 目录结构

```
docs/wiki/
├── index.md              # 内容索引（导航入口）
├── log.md                # 变更日志（append-only）
├── .gitignore            # 排除临时文件
├── modules/              # 模块文档
├── features/             # 功能文档
├── flows/                # 业务流程
├── architectures/        # 架构级文档
└── queries/              # 查询沉淀
```

## 许可

[Apache License 2.0](LICENSE)
