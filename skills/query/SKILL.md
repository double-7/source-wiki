---
name: sw:query
description: 基于 wiki 知识库回答关于代码库的问题
argument-hint: "[question]"
user-invocable: true
disable-model-invocation: true
---

查询 wiki 知识库并回答问题。

问题: $ARGUMENTS

## ★ 前置步骤 — 加载规则

```
${CLAUDE_PLUGIN_ROOT}/agents/wiki-maintainer.md
```

## 查询流程

当用户提出关于代码库的问题时：

1. **结构化定位**：阅读 `docs/wiki/wiki.json`，利用 `modules`/`features`/`flows` 的结构化索引精确定位相关知识区域。关系类查询（依赖、引用）可直接从 wiki.json 回答，无需读页面
2. **知识检索**：读定位到的 wiki 页面完整内容
3. **回源精确定位**：如果 wiki 信息不足，利用 `features[X].source` 精确跳转到源码文件
4. **综合回答**：基于 wiki 知识（和源码补充）给出结构化回答
5. **矛盾检测**：如果回源时发现 wiki 描述与源码不一致，在回答末尾附加建议

### 矛盾处理

当发现 wiki 内容与源码不一致时，按以下逻辑处理：

**简单事实矛盾**（单页面、源码可验证、影响明确）：

1. 在回答中说明发现的矛盾
2. 使用 AskUserQuestion 展示详情：
   ```
   wiki 说"认证使用 JWT"，源码实际使用 OAuth2 + session。
   是否修正 [[user-login]] 页面？
   ```
3. 用户确认 → 执行 inline fix（修改页面内容 + 更新 wiki.json revision + 追加 log.md）
4. 用户拒绝 → 写 issues 到页面 frontmatter，告知用户"已记录此问题。运行 /sw:lint 将统一处理。"

**复杂不一致**（跨页面、需要全局判断、影响不明确）：

1. 在回答中说明发现的不一致
2. 写 issues 到当前正在阅读的相关页面 frontmatter
3. 告知用户："已记录此问题。运行 `/sw:lint` 将统一处理。"

## 沉淀控制

沉淀（创建或更新 wiki 页面）**必须由用户明确触发**。agent 不自主沉淀。

### Agent 认为值得沉淀时

当回答满足以下条件之一时，agent 应在回答末尾使用 AskUserQuestion 询问用户是否沉淀：

- 综合了多个 wiki 页面的分析
- 涉及跨模块的对比或关系
- 包含流程梳理或设计洞察
- 补充或修正了已有 wiki 页面中的信息

询问时展示拟沉淀的完整内容（新增页面的全文，或更新页面的 diff），让用户看到具体会改什么。选项包含"确认沉淀"、"仅作参考"和"通过 lint 沉淀到更合适的层级"。

### 沉淀路径选择

根据洞察的性质推荐沉淀目标：

| 洞察类型 | 推荐路径 | 说明 |
|---------|---------|------|
| 跨模块分析 | `queries/` 或写 issues | 复杂跨模块分析沉淀为 query 页面；跨页面一致性问题写 issues 交给 lint |
| 隐式约定发现 | 建议补充 guideline | 在 module/feature 页面添加 guideline |
| 一次性查询答案 | `queries/` 目录 | 当前默认路径 |

### 用户确认沉淀时

根据分析内容与已有 wiki 的关系执行：

**新增页面**——在 `docs/wiki/queries/` 下创建新页面（含完整 frontmatter，type: query），更新 `docs/wiki/index.md`。

**更新已有页面**——将展示给用户确认的内容写入目标页面（可以是追加段落、修正内容或整体覆盖），更新页面的 `updated` 日期。

然后：
- 更新 `wiki.json`：`revision` +1；如沉淀为新的 feature，同时写入 `features` 中对应条目
- 追加 `log.md`

### 不建议沉淀的情况

- 一次性简单事实查询（如"某个函数在哪个文件"）
- 答案可以直接从单个 wiki 页面获取且无需修正
