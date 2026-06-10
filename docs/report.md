# Source-Wiki 插件改进分析报告

> 基于 v0.7.0 代码和真实项目使用反馈的对抗性分析

## 1. 分析概览

### 1.1 分析方法

对项目全部源文件（schemas、4 个 SKILL.md、8 个模板、hook 脚本、query 脚本、design doc）进行交叉审查，结合真实项目使用反馈（27 个 wiki 页面、62+ 源码文件的实战经验），从 5 个维度进行对抗性分析：

- **Schema / 数据模型**：知识模型是否支撑所有使用场景
- **Skill 流程**：init/ingest/lint/query 流程是否有信息丢失
- **模板质量**：模板指令是否精确到足以让 LLM 一致执行
- **代码质量**：JS 脚本和 Hook 是否有遗漏和 bug
- **跨文件一致性**：文档层（WHY/WHAT/HOW）之间是否矛盾

### 1.2 问题统计

| 级别 | 数量 | 说明 |
|------|------|------|
| P0 | 0 | 无阻断性问题，核心流程可工作 |
| P1 | 5 | 显著功能缺口，导致 wiki 事实性质量不足 |
| P2 | 4 | 改进项，提升一致性和可用性 |

### 1.3 核心发现

插件的结构化知识模型和操作模型设计优秀。主要改进空间集中在 **"事实性验证"维度**——当前 wiki 保证结构正确，但不保证数值准确。具体表现为：

- **init** 创建骨架但不提取可验证的事实锚点
- **ingest** 感知文件变更但不感知常量值变更
- **lint** 有 4 个维度但无系统性事实比对
- **query-wiki.js** 只支持字段查询不支持全文搜索
- **模板** 证据判定标准不明确导致执行不一致

---

## 2. P1 问题清单

### P1-1: Lint 缺少事实性验证维度

**分类**：skill-flow / **共识度**：5/5（反馈 1.2 + 3.3 + 5.1）

**问题描述**：
Lint 当前有 4 个维度（freshness → coverage → integrity → consistency），其中 consistency 包含 CODE 验证（抽样读取源码与 wiki 描述比对），但这是**抽样式**的，没有系统性提取常量值、方法签名等可验证事实进行比对。

**证据**：
- 反馈报告发现 3 个常量值错误（FEC 范围 0-99→0-3、MTU 8961→8956、apiRecvBuf 10MB→32MB），现有 lint 无法系统性捕获
- 反馈原文："常量值错误是最常见且最危险的一类问题——结构性正确但事实性失实"
- `skills/lint/SKILL.md:167` — consistency CODE 验证仅"抽样读取关键部分"

**修复方案**：
- 在 lint 维度中新增 `factual` 维度（事实性验证），位于 consistency 之后
- 系统性提取 wiki 中出现的常量值、方法签名、类名引用
- 与 source 文件中的声明进行自动化比对
- 同步更新 `hooks/wiki-hook.js` 的 dimensions 校验列表
- 新增 ADR #36 到 `docs/design.local.md`

**影响文件**：`skills/lint/SKILL.md`、`hooks/wiki-hook.js`、`docs/design.local.md`

---

### P1-2: Init 不提取可验证事实锚点

**分类**：skill-flow / **共识度**：5/5（反馈 3.1 + 5.1）

**问题描述**：
Init 从源码提取结构（签名、导出、关系）创建 wiki 骨架，但不提取关键常量值。导致 wiki 从创建之初就缺乏可验证的事实基础——常量值只能由 LLM 凭记忆/推测填入，无法与源码交叉验证。

**证据**：
- `skills/init/SKILL.md:128-136` — Tier 1/2 只读签名和结构，不提取常量值
- 反馈原文："wiki 从创建之初就带有可验证的事实锚点"

**修复方案**：
- 在 init §4.1 分析源码步骤中新增"关键常量采集"子步骤
- Grep 模块内 `static final` / `const` / `enum` 声明
- 仅采集业务关键常量（配置阈值、缓冲区大小、超时值、枚举范围）
- 记录常量名、值和所在文件，写入 feature 页面实现逻辑章节

**影响文件**：`skills/init/SKILL.md`

---

### P1-3: Ingest 不感知常量值变更

**分类**：skill-flow / **共识度**：5/5（反馈 3.2）

**问题描述**：
Ingest 通过 git diff 检测文件变更并映射到 wiki 页面，但对 diff 中的常量值修改（如 `MAX_POOL_SIZE` 从 10 改为 20）不会主动搜索 wiki 中引用了旧值的页面。常量值可能在 wiki 正文中被引用但不属于任何 feature 的 source 字段范围。

**证据**：
- `skills/ingest/SKILL.md:69-93` — 影响分析只有 direct（source 匹配）和 indirect（关系推导），无常量值感知
- 反馈原文："diff 中包含 static final 常量的值变更，应主动搜索 wiki 中引用了旧值的页面"

**修复方案**：
- 在 ingest §4.3 影响分析中新增"常量值变更检测"步骤
- 如果 diff 包含 `static final` / `const` / `enum` 声明的值变更
- 提取变更的常量名和新旧值
- Grep wiki 正文搜索旧值或常量名
- 命中页面加入 direct targets

**影响文件**：`skills/ingest/SKILL.md`

---

### P1-4: query-wiki.js 缺少全文搜索

**分类**：code / **共识度**：5/5（反馈 4.1）

**问题描述**：
query-wiki.js 仅支持单字段精确/子串匹配（`--field` + `--contains`/`--equals`），无法跨字段全文搜索。实际使用中需要"查找所有引用了 `UdpCommRecvQueue` 的页面"这种跨字段搜索，现有工具不支持。

**证据**：
- `scripts/query-wiki.js:115-134` — matchField 函数只检查单个字段
- 反馈原文："查找所有引用了 UdpCommRecvQueue 的页面这种跨字段全文搜索，现有工具不支持"

**修复方案**：
- 新增 `--fulltext <keyword>` 选项
- 启用时搜索所有 frontmatter 字段值 AND markdown 正文内容
- 返回匹配页面列表，包含匹配片段

**影响文件**：`scripts/query-wiki.js`

---

### P1-5: 模板证据判定标准不明确

**分类**：template / **共识度**：5/5（反馈 2.1）

**问题描述**：
所有模板反复出现"扩展章节仅在源码有明确证据时添加，无证据不要创建"，但未定义"明确证据"的判定标准。不同 agent 执行时判定不一致——有的添加代码片段作为证据，有的跳过。

**证据**：
- `templates/feature.md:13` — "扩展章节仅在源码有明确证据时添加，无证据不要创建"
- `templates/module.md:11`、`templates/flow.md:11`、`templates/api.md:16`、`templates/conventions.md:16`、`templates/deployment.md:16` — 同样表述
- 反馈原文："agent 对'明确证据'的判定不一致"

**修复方案**：
- 在所有模板的顶部证据说明中追加具体判定标准示例：
  - ✅ 有证据：源码中存在对应方法/类/常量
  - ✅ 有证据：配置文件中存在对应字段
  - ❌ 无证据：仅凭命名推测存在某功能
  - ❌ 无证据：从其他页面推断

**影响文件**：`templates/feature.md`、`templates/module.md`、`templates/flow.md`、`templates/overview.md`、`templates/api.md`、`templates/conventions.md`、`templates/deployment.md`

---

## 3. P2 问题清单

### P2-1: 缺少全局健康统计视图

**分类**：architecture / **共识度**：3/5（反馈 4.2）

**问题描述**：缺少快速查看 wiki 整体状态的命令（页面数、覆盖率、guidelines 总数、issues 总数、最近更新时间等）。

**修复方案**：可作为 query-wiki.js 的 `--stats` 模式实现，或在 lint 报告中增加概览行。暂不实现新 skill。

**影响文件**：`scripts/query-wiki.js`（未来）

---

### P2-2: Feature/Module 模板概述重叠

**分类**：template / **共识度**：3/5（反馈 2.2）

**问题描述**：Feature 概述"用 1-2 句话描述"与 Module 概述"用 2-3 句话描述"粒度接近，agent 经常在两者之间重复相同信息。

**修复方案**：在 Module 模板概述中明确"不重复下属 feature 的功能描述，仅说明为什么这些 feature 被归为一组"。

**影响文件**：`templates/module.md`

---

### P2-3: "可验证性"设计原则不够突出

**分类**：architecture / **共识度**：3/5（反馈 5.1）

**问题描述**：Source-Wiki 的核心理念是"真相源是机器可读且版本可控的"，但这个优势主要在 init 阶段利用，在后续 lint/ingest 中利用不够充分。

**修复方案**：将"可验证性"作为补充原则写入设计文档，随 P1-1/P1-2/P1-3 的修复自然落实。

**影响文件**：`docs/design.local.md`

---

### P2-4: Hook 时间戳校验不严格

**分类**：code / **共识度**：1/5（代码分析发现）

**问题描述**：js-yaml 将 `2026-04-21`（纯日期）解析为 Date 对象，Hook 的 `instanceof Date` 检查直接通过，不校验是否包含时间部分。Schema 要求 ISO 8601 秒级时间戳。

**证据**：`hooks/wiki-hook.js:188` — `if (fm[f] instanceof Date) continue;`

**修复方案**：风险低（模板和程序生成的时间戳格式正确），暂不修复。

**影响文件**：`hooks/wiki-hook.js`（未来）

---

## 4. 设计同步检查

| 变更 | 涉及决策层 | 同步操作 |
|------|-----------|---------|
| Lint 新增 factual 维度 | WHY（新 ADR #36） | 更新 design.local.md |
| Init 常量采集 | HOW（流程变更） | 仅改 init/SKILL.md |
| Ingest 常量检测 | HOW（流程变更） | 仅改 ingest/SKILL.md |
| query-wiki.js --fulltext | HOW（工具增强） | 仅改 scripts/query-wiki.js |
| 模板证据标准 | WHAT（规则细化） | 仅改 templates |
| Hook dimensions 校验 | HOW（校验同步） | 同步更新 wiki-hook.js |

无需更新 wiki-schema.md（lint dimensions 定义在 SKILL.md 内联，per ADR #19）。

---

## 5. 修复与验收记录

### 5.1 修复轮次

**Round 1 — 初始修复（5 P1 + 2 P2）**：

| 问题 | 修复内容 | 文件 |
|------|---------|------|
| P1-1 | Lint 新增 factual 维度（§5.5），含常量值/类名/方法签名验证 | lint/SKILL.md, wiki-hook.js |
| P1-2 | Init 新增"关键常量采集"步骤（§4.1） | init/SKILL.md |
| P1-3 | Ingest 新增"常量值变更检测"（§4.3），使用 --fulltext | ingest/SKILL.md |
| P1-4 | query-wiki.js 新增 --fulltext 全文搜索选项 | query-wiki.js |
| P1-5 | 7 个模板追加证据判定标准 | templates/*.md |
| P2-2 | Module 模板概述去重 | templates/module.md |
| P2-3 | 新增"可验证性 > 推测"设计原则 + ADR #36-38 | design.local.md |

**Round 2 — 对抗性审查修复（13 findings → 8 BLOCKER + 5 WARNING）**：

| 审查发现 | 修复内容 | 文件 |
|---------|---------|------|
| §6.3 仍写"四个维度" | → "五个维度" | lint/SKILL.md |
| design.local.md "四维度" | → "五维度健康检查（含事实性验证）" | design.local.md |
| Ingest "Grep wiki 正文" 模糊 | → 指定 `query-wiki.js --fulltext` 命令 | ingest/SKILL.md |
| Ingest 常量检测全归 direct | → feature=direct, 其他=indirect | ingest/SKILL.md |
| Ingest 去重不含 intent | → "已在 direct、indirect 或 intent 中" | ingest/SKILL.md |
| --fulltext 空关键词 | → 添加非空校验 | query-wiki.js |
| --fulltext BOM 处理 | → fulltextSearch 剥离 BOM | query-wiki.js |
| --fulltext 无值参数（死代码） | → 移至外层独立校验 | query-wiki.js |
| --fulltext 冲突参数 | → 添加冲突检测 | query-wiki.js |
| --fulltext __error 泄露 | → fulltext 路径正确处理无效 frontmatter | query-wiki.js |
| consistency/factual 重叠 | → consistency 只做 wiki 内部一致性，factual 做 CODE 比对 | lint/SKILL.md |
| factual 不跳过已删 source | → 添加"前置过滤"跳过 freshness 已标记页面 | lint/SKILL.md |
| factual scope 处理模糊 | → 明确使用 query-wiki.js 查找模块 features | lint/SKILL.md |

**Round 3 — 最终验证**：独立 correctness reviewer 确认 **无 P0/P1 问题残留**。
