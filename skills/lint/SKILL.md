---
name: sw:lint
description: 对 wiki 知识库进行健康检查，输出结构化报告
user-invocable: true
disable-model-invocation: true
context: fork
agent: wiki-maintainer
---

执行 lint 操作。

对当前项目的 `docs/wiki/` 知识库进行全面健康检查。

## 检查维度

- **一致性**：不同页面之间是否有矛盾的说法
- **孤立页面**：哪些页面没有被任何其他页面引用（入站链接为 0）
- **缺失页面**：正文中提到的 `[[双链]]` 是否都有对应的实际文件
- **数据缺口**：哪些重要模块/功能/流程还没有被文档化
- **过时信息**：frontmatter 中的 `source` 路径和 `features[X].source` 是否都指向有效文件
- **交叉引用**：有关系的页面是否互相引用了对方
- **归属完整性**：每个 feature 页面的 `module` 字段是否都指向了存在的模块页面，且 `features[X].module` 是否对应 `modules` 中存在的条目
- **层级正确性**：页面内容是否匹配其所在层级（如 flow 页面不应描述单个 feature 的内部实现）

## 输出

按照 `${CLAUDE_PLUGIN_ROOT}/templates/lint-report.md` 模板格式输出健康报告。报告必须覆盖所有八个检查维度，并建议下一步应摄取哪些源码来填补缺口。完成后追加 log.md。

## wiki.json 更新

如果 lint 对 wiki 做了修改（删除孤立页面、修复链接等），更新 `wiki.json`：`revision` +1，如涉及页面增删则同步更新对应的 `features`/`modules` 条目。
