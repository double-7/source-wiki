---
name: sw:query
description: "基于 wiki 知识库回答关于代码库的问题"
argument-hint: "[question]"
user-invocable: true
disable-model-invocation: true
---

查询 wiki 知识库并回答问题。直接在用户会话中执行，不使用 REACT。

问题: $ARGUMENTS

## 前置步骤

读取 `${CLAUDE_PLUGIN_ROOT}/agents/wiki-maintainer.md` 加载共享规则。

## 查询流程

### 1. 结构化定位

阅读 `docs/wiki/wiki.json`，利用 modules/features/flows 结构化索引精确定位相关知识区域。

关系类查询（依赖、引用关系）可直接从 wiki.json 回答，无需读页面。

### 2. 知识检索

读定位到的 wiki 页面完整内容。

### 3. 回源精确定位

如果 wiki 信息不足，利用 `features[X].source` 精确跳转到源码文件。只读必要的内容。

### 4. 综合回答

基于 wiki 知识（和源码补充）给出结构化回答。

### 5. 矛盾检测

如果回源时发现 wiki 描述与源码不一致，按修复边界处理：

**简单事实矛盾**（单页面、源码可验证、影响明确）：

1. 在回答中说明发现的矛盾
2. AskUserQuestion 展示详情，询问是否修正
3. 用户确认 → 执行 inline fix（修改页面 + 更新 wiki.json revision + 追加 log.md）
4. 用户拒绝 → 写 issues 到页面 frontmatter

**复杂不一致**（跨页面、需要全局判断）：

1. 在回答中说明发现的不一致
2. 写 issues 到相关页面 frontmatter
3. 告知用户"已记录。运行 `/sw:lint` 将统一处理。"

## 沉淀控制

沉淀（创建或更新 wiki 页面）**必须由用户明确触发**。agent 不自主沉淀。

### 何时建议沉淀

当回答满足以下条件之一时，AskUserQuestion 询问是否沉淀：

- 综合了多个 wiki 页面的分析
- 涉及跨模块的对比或关系
- 包含流程梳理或设计洞察
- 补充或修正了已有 wiki 页面信息

询问时展示拟沉淀的完整内容（新增页面的全文，或更新页面的 diff）。

选项：
- "确认沉淀"
- "仅作参考"
- "通过 lint 沉淀到更合适的层级"

### 沉淀路径

根据洞察性质推荐目标（不限类型）：

| 洞察类型 | 推荐路径 |
|---------|---------|
| 跨模块分析 | queries/ 或写 issues |
| 隐式约定发现 | 建议补充 guideline |
| 新功能/流程发现 | features/ 或 flows/ |
| 一次性查询答案 | queries/ |

### 用户确认沉淀后

根据分析内容与已有 wiki 的关系执行：

**新增页面**——创建页面（含完整 frontmatter），更新 index.md。可以是任何类型（feature、flow、query 等）。

**更新已有页面**——将内容写入目标页面，更新 updated 日期。

然后：
- 更新 wiki.json：revision +1；如涉及新 feature/flow，写入对应条目
- 追加 log.md

### 不建议沉淀

- 一次性简单事实查询（如"某个函数在哪个文件"）
- 答案可以直接从单个 wiki 页面获取且无需修正
