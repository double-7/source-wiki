---
name: sw:ingest-act
description: "处理单个 ingest target（rename/direct/correlated/flow/convention），自包含执行"
user-invocable: false
context: fork
agent: wiki-maintainer
---

处理单个 ingest target。由 `sw:ingest` 编排器通过 Skill tool 调用。

Target ID: $ARGUMENTS

## 获取上下文

1. 读取 `docs/wiki/wiki.json`
2. 从 `process.ingest.targets` 中找到 `id == $ARGUMENTS` 的 target
3. 获取 target 的 `type`、`status`（必须为 pending）、`reason`（如有）
4. 读取目标页面的 frontmatter `guidelines`（如果页面存在）

如果 target 不存在或已 completed → 报错退出。

## 按 type 执行

### type == "rename"（源码文件重命名）

1. **从 reason 中提取重命名对**：`reason` 格式为 `old_path → new_path`
2. **更新 wiki.json**：在 `features[target.id].source` 中将 `old_path` 替换为 `new_path`
3. **更新 feature 页面**：替换页面内容和 frontmatter 中对旧路径的引用，更新 `updated` 日期
4. **更新 index.md**：如涉及页面标题变更则同步更新

rename 类型不需要重读源码，只做路径替换。

### type == "direct"（源码文件变更命中 feature）

1. **读取目标 feature 的 wiki 页面**：获取当前描述和 frontmatter `guidelines`
2. **读取源码 Tier 1 签名**：按分层阅读策略，读取 feature.source 中变更文件的导出签名、类型定义、注释
3. **对比分析**：
   - 有结构变化（新导出、改接口、新增类型）→ 更新页面中对应段落
   - 新旧矛盾（文档说 X 但代码已改为 Y）→ **检查 guidelines**：
     - 有 guidelines 且与代码矛盾 → 遵循 guideline，不覆盖
     - 无 guidelines → 基于代码直接更新
   - 无结构变化 → 跳过页面更新，仅标记 completed
4. **处理特殊情况**：
   - 新增文件无法匹配已有 feature → 创建新 feature 页面 + 注册到 wiki.json 的 features 和对应 module.features
   - 删除文件导致 feature 无剩余 source → 删除页面 + 清理 wiki.json 条目 + 清理 index.md 中的双链

### type == "correlated"（上游模块变更的关联影响）

1. **读取目标 feature 的 wiki 页面**：获取当前描述和 frontmatter `guidelines`
2. **读取变更符号的新签名**（Tier 1）：获取上游变更符号的当前导出签名
3. **定位页面中引用该符号的段落**，按以下处理：
   - **有 guideline** → 按 guideline 更新描述
   - **无 guideline** → 基于新签名更新；信息不足以判断影响时追加审查标注：

```markdown
> **⚠️ 审查建议**：上游 {reason} 已变更，请核实本页面中引用的相关描述是否仍准确。
> — *ingest {日期}*
```

4. 更新页面的 `updated` 日期

### type == "flow"（涉及的跨模块流程）

1. **读取 flow 页面**：获取当前描述和 frontmatter `guidelines`
2. **定位涉及变更模块的步骤**，按以下处理：
   - **有 guideline** → 按 guideline 更新步骤描述
   - **无 guideline** → 基于变更模块最新状态更新；信息不足以判断影响时追加审查标注：

```markdown
> **⚠️ 审查建议**：本流程涉及的模块已变更（{reason}），请核实步骤描述是否仍准确。
> — *ingest {日期}*
```

3. 更新页面的 `updated` 日期

### type == "convention"（模块约定验证）

1. **读取约定描述**：从 wiki 页面或 wiki.json 的 modules[X].conventions 中获取约定内容
2. **读取源码验证**：抽查相关源码，验证约定是否仍然成立
3. **更新 wiki.json**：
   - 约定仍成立 → findings 中记录 `✓ {convention}`
   - 约定已失效 → findings 中记录 `⚠️ {convention} — {失效原因}`，并在模块页面中标注

## 更新 wiki.json

无论哪种 type，完成后都必须：

1. 将 `process.ingest.targets` 中对应 target 的 `status` 改为 `"completed"`
2. 如果是 direct 类型且更新了 feature，同步更新 `features[target.id]` 的 `source`/`imports`
3. `revision` +1
4. 更新 `lastUpdated`
5. 写回完整的 wiki.json

## 返回极简摘要

向编排器返回摘要：target id、type、执行动作、关键变更。编排器会从 wiki.json 重建完整报告。
