---
name: sw:lint-act
description: "流式执行所有 pending lint 维度检查，到容量上限自动保存退出"
user-invocable: false
context: fork
agent: wiki-maintainer
---

执行所有 pending 维度的 lint 检查。由 `sw:lint` 编排器通过 Skill tool 调用。

每完成一个维度立即保存 wiki.json，确保中断不丢失进度。容量不足时保存退出，编排器会再次调用处理剩余维度。

## 执行流程

### 1. 读取上下文

1. 读取 `docs/wiki/wiki.json`
2. 获取 `process.lint.dimensions` 中所有 `status == "pending"` 的维度
3. 如果无 pending 维度 → 报告"无待处理维度"并退出

### 2. 维度执行顺序

按成本从低到高处理，共享页面读取结果：

1. **staleInfo** — Glob 验证 source 路径，不读页面内容
2. **orphanPages** — 扫描文件列表，检查入站链接
3. **missingPages** — 扫描双链，检查文件存在
4. **crossReferences** — 基于 frontmatter 和 wiki.json 字段检查
5. **moduleAttribution** — 基于 frontmatter 和 wiki.json 字段检查
6. **consistency** — 对比多页面描述，需读正文
7. **hierarchyCorrectness** — 检查内容是否匹配层级，需读正文
8. **dataGaps** — 检查内容充实度，需读正文

跳过列表中非 pending 的维度。

### 3. 逐维度执行

按上述顺序处理每个 pending 维度。每个维度完成后执行 **保存步骤**（见第 4 步），再继续下一个。

维度检查规则：

#### consistency — 一致性

- 读取多个相关页面，对比对同一概念的不同描述
- 重点检查：feature 页面与所属 module 页面的描述是否矛盾
- 检查 wiki.json 中 features 的 imports 与页面中描述的依赖是否一致

#### orphanPages — 孤立页面

- 扫描 `docs/wiki/` 下所有 .md 文件（排除 index.md 和 log.md）
- 检查每个页面是否有入站链接（从 index.md 或其他页面指向它）
- wiki.json 中的 modules/features/flows 是否都有对应的实际页面文件

#### missingPages — 缺失页面

- 扫描所有 wiki 页面中的 `[[双链]]` 语法
- 检查每个双链是否有对应的实际 .md 文件
- 列出所有指向不存在页面的双链

#### dataGaps — 数据缺口

- 检查 wiki.json 中 modules 是否都有对应的 module 页面且内容充实
- 检查 features 是否都有对应的 feature 页面
- 检查 modules 中 dependencies 提到的依赖是否有对应模块
- 检查是否缺少明显的跨模块 flow 页面

#### staleInfo — 过时信息

- 读取 wiki.json 中 features[X].source 和 modules[X].source 路径
- 验证这些路径指向的文件/目录是否仍然存在
- 列出所有指向不存在路径的条目

#### crossReferences — 交叉引用

- 对于 wiki.json 中标记了依赖关系的模块，检查页面之间是否有互相引用
- 对于 features 中有 imports 的条目，检查页面中是否引用了被 import 模块的 feature 页面
- 对于 flows 中涉及的模块，检查 flow 页面是否引用了对应的 module 页面

#### moduleAttribution — 归属完整性

- 检查每个 feature 页面的 frontmatter `module` 字段是否指向存在的模块
- 检查 `features[X].module` 是否在 `modules` 中有对应条目
- 检查 `modules[X].features` 列表是否与 features 中 `module == X` 的条目一一对应

#### hierarchyCorrectness — 层级正确性

- 检查 flow 页面是否只描述跨模块流程（不应描述单个 feature 的内部实现）
- 检查 module 页面是否只描述领域划分（不应详细描述单个 feature 的实现）
- 检查 feature 页面是否足够具体（不应泛泛描述整个模块）

### 4. 保存步骤（每个维度完成后执行）

1. 将 `process.lint.dimensions` 中对应维度标记为 `"completed"`
2. 将检查发现追加到 `process.lint.findings` 数组，每条 finding 格式：

```json
{
  "dimension": "{维度名}",
  "severity": "error | warning | info",
  "page": "{受影响页面路径}",
  "description": "{发现描述}",
  "fixType": "safe | content | none",
  "fixPlan": "{修复方案描述，content 类型必填}"
}
```

字段说明：
- `fixType` — 修复类型分类：
  - `"safe"`：安全修复（缺失双链、错误 module 字段、frontmatter/wiki.json 不同步），**lint-act 直接执行**
  - `"content"`：内容修复（页面拆分/合并、内容重写、补充空洞页面），**lint-act 只记录方案，由编排器确认后执行**
  - `"none"`：仅报告，不修复（如架构层面的建议、源码路径已失效需人工确认）
- `fixPlan` — 修复方案描述。`content` 类型必填，描述具体要做什么。`safe` 类型可选（描述已执行了什么）。`none` 类型不需要

3. **安全修复直接执行**：对于 `fixType: "safe"` 的发现，在检查过程中直接修复：
   - 补全缺失的双链 → 编辑对应页面，添加 `[[双链]]`
   - 修正错误的 module 字段 → 编辑 feature 页面 frontmatter 中的 `module` 字段
   - 同步 wiki.json 与页面 frontmatter 的不一致 → 以 wiki.json 为准更新 frontmatter
   - 安全修复是幂等的，中断后重跑不会重复修复

4. 写回 wiki.json

5. **容量检查**：评估剩余容量是否足够处理下一个维度
   - 不足以处理下一个维度 → 返回摘要退出
   - 充足 → 继续下一个 pending 维度

### 5. 返回摘要

返回处理的维度清单、各维度问题数量、安全修复数量。编排器从 wiki.json 的 findings 重建完整报告。
