---
name: sw:query
description: 基于 wiki 知识库回答关于代码库的问题
argument-hint: "[question]"
user-invocable: true
disable-model-invocation: true
context: fork
agent: wiki-maintainer
---

执行 query 操作。

问题: $ARGUMENTS

## 查询流程

当用户提出关于代码库的问题时：

1. **搜索 wiki**：先阅读 `docs/wiki/index.md`，定位相关页面
2. **深入阅读**：阅读相关页面的完整内容
3. **必要时回源**：如果 wiki 中的信息不足以回答问题，去读取实际源码
4. **综合回答**：基于 wiki 知识（和源码补充）给出结构化回答

## 沉淀控制

沉淀（创建新 wiki 页面）**必须由用户明确触发**。agent 不自主沉淀。

### 用户明确要求沉淀时

当用户的问题中包含"保存"、"沉淀"、"记录"等明确意图时，执行沉淀：
1. 在 `docs/wiki/queries/` 下创建新页面（含完整 frontmatter）
2. 更新 `docs/wiki/index.md` 的查询沉淀部分
3. 更新 `wiki.json`：`revision` +1；如沉淀为新的 feature，同时写入 `features` 中对应条目（module、source、imports、page）
4. 追加 `log.md`

### Agent 认为值得沉淀时

当回答满足以下条件之一时，agent 应在回答末尾输出沉淀建议（但**不执行**沉淀）：

- 综合了多个 wiki 页面的分析
- 涉及跨模块的对比或关系
- 包含流程梳理或设计洞察

输出格式：

```markdown
---

💡 **建议沉淀** — [一句话说明原因]

<details>
<summary>建议页面内容（展开后由主会话创建文件）</summary>

---
type: query
title: "页面标题"
source: []
created: YYYY-MM-DD
tags: [标签]
related: ["[[关联页面]]"]
---

[完整的 wiki 页面内容]

</details>
```

主会话用户看到建议后自行决定是否沉淀。

### 不建议沉淀的情况

- 一次性简单事实查询（如"某个函数在哪个文件"）
- 答案可以直接从单个 wiki 页面获取
