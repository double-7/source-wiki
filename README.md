# source-wiki

将源码快速映射为结构化 wiki 知识库的 Claude Code 插件。利用大模型加速处理，推动知识持续积累与复用；人负责审核校正，保持专注与方向。

灵感源自 Karpathy 的 [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) 模式：与其每次提问都让 LLM 从源码重新检索和推理，不如让 LLM 持续构建和维护一份结构化 wiki——知识编译一次，持续保持更新，而非每次重新推导。

## 核心理念

传统的代码理解方式依赖人在脑海中积累对项目的认知——哪些模块负责什么、模块之间如何协作、哪些设计决策背后有故事。这些知识分散在代码注释、PR 讨论、口头传递中，随人员流动而流失。

source-wiki 将这种隐性知识转化为显性的、结构化的 wiki 知识库：

- **LLM 负责繁重的维护工作**——扫描源码、提取关键信息、建立交叉引用、检测矛盾、保持一致性。这些工作让人类来做既枯燥又容易遗漏
- **人负责方向和判断**——确认模块划分是否合理、审查 LLM 不确定的区域、决定哪些知识值得深入记录
- **知识持续复利**——每次分析、每次查询沉淀的有价值结论，都让 wiki 变得更完整。新加入的团队成员读 wiki 就能快速理解项目全貌

## 安装

### 从 GitHub 安装

```bash
claude plugin install https://github.com/double-7/source-wiki
```

### 本地开发模式

```bash
claude --plugin-dir /path/to/source-wiki
```

## 使用

安装后，在任意项目中使用以下命令：

### `/sw:init [source-path]`

全量分析源码并构建 wiki 知识库骨架。交互式运行，关键节点需用户确认。

- 读取元数据和签名（不读所有源码实现），提出模块划分方案
- 用户确认后，逐模块生成分层 wiki 页面
- 支持中断恢复：中断后重新运行会从上次位置继续

```bash
# 首次全量分析
/sw:init src/
```

### `/sw:ingest [source-path]`

增量同步 wiki 与源码变更。自主运行，无需用户交互。

- 要求 wiki 已通过 `/init` 完成全量构建
- 通过 git diff 检测源码变化，更新受影响的 wiki 页面
- 自动创建、更新或删除对应的 wiki 页面

```bash
# 源码变更后同步 wiki
/sw:ingest src/
```

Wiki 输出目录：`docs/wiki/`

### `/sw:query [question]`

基于 wiki 知识库回答关于代码库的问题。

```bash
/sw:query 认证流程是怎么工作的
```

### `/sw:lint`

对 wiki 知识库进行健康检查，输出结构化报告。

```bash
/sw:lint
```

## Wiki 目录结构

```
docs/wiki/
├── index.md              # 内容索引
├── log.md                # 变更日志
├── architectures/        # 项目架构级文档
│   └── overview.md       # 项目总览
├── modules/              # 模块文档
├── features/             # 功能文档
├── flows/                # 业务流程
└── queries/              # 查询沉淀
```

## 添加源码项目

### 方式一：当前项目内嵌

源码和 wiki 在同一项目中：

```
project/
├── src/              # 源码
├── docs/wiki/        # 插件生成的知识库
└── ...
```

直接运行 `/sw:init src/` 即可。

### 方式二：指定外部路径

```bash
/sw:init C:/projects/other-app/src/
```

插件直接读取指定路径下的文件。

### 方式三：Git 仓库

先克隆仓库到本地，然后指定路径分析。

## 许可

[Apache License 2.0](LICENSE)
