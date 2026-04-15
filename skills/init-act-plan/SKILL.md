---
name: sw:init-act-plan
description: "扫描源码元数据，制定模块划分方案，生成 wiki 骨架"
argument-hint: "[source-path]"
user-invocable: false
context: fork
agent: wiki-maintainer
---

对指定源码路径执行 Plan 阶段——扫描元数据、制定模块划分方案、生成 wiki 骨架。

源码路径: $ARGUMENTS

## 执行流程

### 1. 前置校验

确认 `docs/wiki/wiki.json` 不存在。如果已存在，输出错误信息并停止（Plan 阶段仅在 wiki 未初始化时由 init 调用）。

### 2. 排除过滤

扫描前确定排除范围，避免将生成代码、依赖包、构建产物混入分析。

**读取 .gitignore**：检查项目根目录和源码路径下是否有 `.gitignore`。提取其中的排除模式。

**始终排除**（无论 .gitignore 是否包含）：
- 依赖目录：`node_modules/`, `vendor/`, `__pypackages__/`
- 构建产物：`dist/`, `build/`, `out/`, `target/`, `.next/`, `.nuxt/`, `.output/`
- 运行时缓存：`__pycache__/`, `.cache/`, `.turbo/`, `.gradle/`
- 版本控制：`.git/`, `.svn/`
- 非源码目录：`coverage/`, `.husky/`, `.github/`, `docs/wiki/`（防止扫描插件自身的产出）

**应用方式**：
- Grep 操作基于 ripgrep，已默认尊重 .gitignore，无需额外处理
- Glob 操作返回结果后，排除匹配上述规则的路径，再进行后续分析
- 如果 Glob 返回的路径中超过 50% 被排除，说明过滤有效；反之如果几乎无排除，说明项目本身比较干净

### 3. 扫描源码元数据

按以下顺序读取源码元数据，只读签名和结构，不读实现：

1. **目录结构**：Glob 项目目录（depth 3），应用排除过滤
2. **包管理文件**（选读最相关的一个）：`package.json` / `pom.xml` / `go.mod` / `Cargo.toml` / `pyproject.toml`
3. **README.md**
4. **入口文件**（1-2 个）：`main.*` / `index.*` / `app.*`
5. **导出签名**：Grep `export` 语句（全项目，仅匹配行，不读文件内容）
6. **依赖关系**：Grep `import` / `require` 语句（全项目，仅匹配行）
7. **类型文件**：Glob `*.d.ts` / `types/*` / `interfaces/*`，应用排除过滤
8. **测试文件名**：Glob `*.test.*` / `*.spec.*` / `*_test.*`，应用排除过滤

如果 export/import 的 Grep 结果过多（超过 200 行匹配），改为按目录分批扫描：
- 按顶层源码目录分组（排除过滤后的目录）
- 对每个目录分别 Grep export（每次只扫描一个目录）
- import 只扫描入口文件和桶文件（`index.ts` / `index.js` / `mod.ts`），不扫全项目

### 4. 制定模块划分方案

基于扫描结果：
- 确定模块边界（主要依据：目录结构、export 聚合、import 依赖）
- 为每个模块列出预估的 features、keyFiles、dependencies
- 确定 processingOrder（按依赖关系从底层到上层）
- 估算跨模块业务流程（estimatedFlows）

对模糊区域标注 `"confidence": "low"` 并说明原因。

### 5. 生成 wiki 骨架

创建以下文件：

1. **wiki.json**：v2 结构。设置 `revision=1`, `process.phase="planned"`, `process.pendingModules=[所有模块]`, `process.completedModules=[]`, `process.processingOrder=[处理顺序]`, `process.estimatedFlows=[预估流程]`；填入 `architectures.techStack`；为每个模块创建 `modules[模块名]` 骨架（source、features、dependencies、page）；空 `features: {}` 和 `flows: {}`
2. **overview.md**：骨架版，参考 `${CLAUDE_PLUGIN_ROOT}/templates/overview.md`，填入项目名和技术栈，其余留空
3. **每个 module 的 stub 页面**：仅 frontmatter + 一句话概述，参考 `${CLAUDE_PLUGIN_ROOT}/templates/module.md`
4. **index.md**：导航骨架，参考 `${CLAUDE_PLUGIN_ROOT}/templates/index.md`
5. **log.md**：初始条目

### 6. 返回摘要

返回以下格式的摘要（严格按此格式）：

```
## Plan 结果

### 模块划分方案
- auth (src/auth/, ~12 files) → features: login, register, token-refresh
- order (src/order/, ~8 files) → features: create, track

### 处理顺序
auth → order → payment（按依赖关系从底层到上层）

### 预估跨模块流程
- 用户认证流程

### 低置信度区域
- [如有的话，列出 confidence: low 的模块及原因]
```
