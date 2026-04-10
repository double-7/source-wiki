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
5. **沉淀**：如果回答具有独立价值（如对比分析、流程梳理、设计洞察），将其保存为 `docs/wiki/queries/` 下的新页面，并更新 index.md

## 判断是否沉淀

- 一次性简单事实查询 → 不沉淀
- 综合多个页面的分析 → 沉淀
- 涉及跨模块的对比或关系 → 沉淀
- 用户明确表示"保存这个分析" → 沉淀

## wiki.json 更新

如果产生了沉淀（新建了页面），更新 `wiki.json`：`revision` +1。
