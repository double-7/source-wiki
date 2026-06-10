---
name: sw:query
description: "基于 wiki 知识库回答关于代码库的问题"
argument-hint: "[question]"
user-invocable: true
---

查询 wiki 知识库并回答问题。直接在用户会话中执行，不使用 REACT。

问题: $ARGUMENTS

## 1. 前置步骤

读取 `${CLAUDE_PLUGIN_ROOT}/schemas/wiki-schema.md` 加载共享规则。

## 2. 前置检查

Glob `docs/wiki/wiki.*.json`：
- 有其他命令的临时文件 → 警告"wiki 正在被其他命令修改，跳过所有页面修改操作"，继续执行（仅读取和回答，不执行 inline fix 或写 issues）
- 无临时文件 → 确认 docs/wiki/ 存在且有页面；不存在 → 报错"请先运行 `/sw:init`"

## 3. 查询流程

### 3.1. 结构化定位

使用 query-wiki.js 按条件查询相关页面：

```bash
# 按类型查询
node ${CLAUDE_PLUGIN_ROOT}/scripts/query-wiki.js --dir docs/wiki --type feature

# 按 tag 搜索
node ${CLAUDE_PLUGIN_ROOT}/scripts/query-wiki.js --dir docs/wiki --field tags --contains <tag>

# 按字段值过滤
node ${CLAUDE_PLUGIN_ROOT}/scripts/query-wiki.js --dir docs/wiki --field source --contains <file>
```

关系类查询（依赖、引用关系）可直接从 query-wiki.js 返回的 frontmatter 结构化数据回答。

### 3.2. 知识检索

读定位到的 wiki 页面完整内容。

### 3.3. 回源精确定位

如果 wiki 信息不足，利用 feature 页面的 `source` 字段精确跳转到源码文件。只读必要的内容。

### 3.4. 综合回答

基于 wiki 知识（和源码补充）给出结构化回答。

### 3.5. 矛盾检测

如果回源时发现 wiki 描述与源码不一致，按修复边界处理：

**简单事实矛盾**（单页面、源码可验证、影响明确）：
1. 在回答中说明发现的矛盾
2. AskUserQuestion 展示详情，询问是否修正
3. 用户确认 → 执行 inline fix（修改页面 + 更新 frontmatter updated）
4. 用户拒绝 → 写 issues 到页面 frontmatter（不更新 `updated`，仅写 issues 不算内容修改）

**复杂不一致**（跨页面、需要全局判断）：
1. 在回答中说明发现的不一致
2. 写 issues 到相关页面 frontmatter（不更新 `updated`，仅写 issues 不算内容修改）
3. 告知用户"已记录。运行 `/sw:lint` 将统一处理。"

## 4. 沉淀控制

沉淀（创建或更新 wiki 页面）**必须由用户明确触发**。agent 不自主沉淀。

### 4.1. 何时建议沉淀

当回答满足以下条件之一时，AskUserQuestion 询问是否沉淀：

- 综合了多个 wiki 页面的分析 → 推荐沉淀为 queries/ 页面
- 涉及跨模块的对比或关系 → 推荐沉淀为 queries/ 页面或写 issues
- 包含可复用的设计模式或隐式约定发现 → 建议补充 guideline
- 补充或修正了已有 wiki 页面信息 → 直接更新目标页面
- 发现新的业务流程或能力单元 → 建议由 `/sw:ingest` 或 `/sw:init` 执行

询问时展示拟沉淀的完整内容。

选项：
- "确认沉淀"
- "仅作参考"

### 4.2. 沉淀路径

根据洞察性质推荐目标：

| 洞察类型 | 推荐路径 |
|---------|---------|
| 跨模块分析 | queries/ 或写 issues |
| 隐式约定发现 | 建议补充 guideline |
| 新功能/流程发现 | features/ 或 flows/ |
| 一次性查询答案 | queries/ |

### 4.3. 用户确认沉淀后

**新增页面**——读取 `${CLAUDE_PLUGIN_ROOT}/templates/query.md`，在 `docs/wiki/queries/` 目录下创建页面（含完整 frontmatter）。在 index.md 的"查询沉淀"章节添加新页面的双链引用（格式：`- [[queries/页面名]] — 一句话摘要`），如该章节显示"尚无页面"则替换占位文本。

**更新已有页面**——将内容写入目标页面，更新 frontmatter `updated`。

然后：
- 更新 index.md 的 `updated` 为当前秒级 ISO 时间戳
- 追加 log.md

### 4.4. 不建议沉淀

- 一次性简单事实查询（如"某个函数在哪个文件"）
- 答案可以直接从单个 wiki 页面获取且无需修正
