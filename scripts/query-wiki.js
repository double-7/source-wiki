#!/usr/bin/env node
'use strict';

/**
 * query-wiki.js — frontmatter 结构化查询
 *
 * 扫描 wiki 目录提取 frontmatter，按条件过滤返回结构化 JSON。
 * LLM 负责推理，脚本负责固定的机械操作。
 *
 * Usage:
 *   node query-wiki.js --dir <wiki-dir> [options]
 *
 * Options:
 *   --dir <path>         （必需）wiki 目录路径，如 docs/wiki。
 *                        脚本递归扫描该目录下所有 .md 文件（排除 log.md），
 *                        提取 YAML frontmatter 作为查询数据源。
 *
 *   --type <type>        按页面类型过滤，只返回指定类型的页面。
 *                        类型映射到目录：feature→features/、module→modules/、
 *                        flow→flows/、architecture→architectures/、query→queries/。
 *                        例：--type feature 只扫描 features/ 目录下的页面。
 *
 *   --field <name>       指定要检查的 frontmatter 字段名。
 *                        必须搭配以下过滤选项之一使用：
 *                          --contains / --equals / --not-empty
 *                        不搭配过滤选项时，等价于字段存在且非空。
 *                        例：--field source → 返回所有有 source 字段且非空的页面。
 *
 *   --contains <value>   （配合 --field）子串匹配。
 *                        对字符串字段：检查字段值是否包含 value。
 *                        对数组字段：检查是否有任一元素包含 value 作为子串。
 *                        例：--field source --contains auth/LoginService
 *                        → 返回 source 中包含 "auth/LoginService" 的 feature 页面。
 *
 *   --equals <value>     （配合 --field）精确匹配。
 *                        对字符串字段：检查字段值是否等于 value。
 *                        对数组字段：检查是否有任一元素等于 value。
 *                        例：--field tags --equals security
 *                        → 返回 tags 数组中包含精确值 "security" 的页面。
 *
 *   --not-empty          （配合 --field）字段非空过滤。
 *                        排除字段不存在、为 null、为空数组、为空字符串的页面。
 *                        例：--field issues --not-empty
 *                        → 返回所有有待处理 issues 的页面（lint 用）。
 *
 *   --dump               输出所有页面的完整 frontmatter，忽略其他过滤条件。
 *                        用于全量快照场景（lint 全量扫描、调试）。
 *                        输出包含 path、frontmatter、type 三个字段。
 *
 *   --fulltext <keyword> 全文搜索模式。搜索所有 frontmatter 字段值和 markdown 正文内容。
 *                        无需搭配 --field，忽略 --type 以外的其他过滤选项。
 *                        返回匹配页面列表，每条包含 path、frontmatter、type、matches。
 *                        matches 为匹配片段数组（最多 3 条，每条含 field/line/snippet）。
 */

const fs = require('fs');
const path = require('path');
const { jsYaml, TYPE_DIRS, DIR_TYPES, extractFrontmatter } = require(path.join(__dirname, '..', 'libs', 'wiki-utils.js'));

// ── 参数解析 ────────────────────────────────────────
const argv = process.argv.slice(2);
function getOpt(name) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}

const wikiDir = getOpt('--dir');
const typeOpt = getOpt('--type');
const fieldOpt = getOpt('--field');
const containsVal = getOpt('--contains');
const equalsVal = getOpt('--equals');
const notEmptyOpt = argv.includes('--not-empty');
const dumpOpt = argv.includes('--dump');
const fulltextVal = getOpt('--fulltext');

if (!wikiDir) {
  process.stderr.write('Usage: query-wiki.js --dir <wiki-dir> [options]\n');
  process.exit(1);
}

// ── 参数冲突检测 ───────────────────────────────────
function requireArg(flag, val, label) {
  if (argv.includes(flag) && val === null) {
    process.stderr.write(`Error: ${flag} requires a ${label} argument\n`);
    process.exit(1);
  }
}
requireArg('--fulltext', fulltextVal, 'keyword');
requireArg('--type', typeOpt, 'type');
requireArg('--field', fieldOpt, 'field name');
requireArg('--contains', containsVal, 'value');
requireArg('--equals', equalsVal, 'value');

if (fulltextVal !== null) {
  if (fulltextVal.trim() === '') {
    process.stderr.write('Error: --fulltext keyword must be non-empty\n');
    process.exit(1);
  }
  if (fieldOpt || containsVal !== null || equalsVal !== null || notEmptyOpt || dumpOpt) {
    process.stderr.write('Error: --fulltext cannot be combined with --field, --contains, --equals, --not-empty, or --dump\n');
    process.exit(1);
  }
}
if ((containsVal !== null || equalsVal !== null || notEmptyOpt) && !fieldOpt) {
  process.stderr.write('Error: --contains, --equals, and --not-empty require --field\n');
  process.exit(1);
}
const filterCount = (containsVal !== null ? 1 : 0) + (equalsVal !== null ? 1 : 0) + (notEmptyOpt ? 1 : 0);
if (filterCount > 1) {
  process.stderr.write('Error: --contains, --equals, and --not-empty are mutually exclusive\n');
  process.exit(1);
}

// ── 递归扫描 .md 文件（仅排除根目录 log.md） ───────
function scanDir(dir, rootDir) {
  const isRoot = dir === rootDir;
  const results = [];
  try { if (!fs.statSync(dir).isDirectory()) return results; }
  catch { return results; }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      try { results.push(...scanDir(full, rootDir)); }
      catch (e) { /* skip unreadable directories */ }
    } else if (entry.name.toLowerCase().endsWith('.md')) {
      if (isRoot && entry.name === 'log.md') continue;
      results.push(full);
    }
  }
  return results;
}

// ── 从相对路径推导页面类型 ─────────────────────────
function pageType(rel) {
  if (rel === 'index.md') return 'index';
  const seg = rel.split('/')[0];
  return DIR_TYPES[seg] || null;
}

// ── 字段过滤 ───────────────────────────────────────
function matchField(value) {
  if (value === undefined || value === null) return false;
  if (containsVal !== null) {
    if (Array.isArray(value)) return value.some(v => String(v).includes(containsVal));
    return String(value).includes(containsVal);
  }
  if (equalsVal !== null) {
    if (Array.isArray(value)) return value.some(v => String(v) === equalsVal);
    return String(value) === equalsVal;
  }
  if (notEmptyOpt) {
    if (value === undefined || value === null) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'string') return value.trim() !== '';
    return true;
  }
  return true;
}

// ── 全文搜索 ───────────────────────────────────────
function fulltextSearch(content, keyword) {
  const MAX_SNIPPETS = 3;
  const CONTEXT_CHARS = 40;
  const snippets = [];

  // Strip UTF-8 BOM if present (consistent with extractFrontmatter)
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);

  const kw = keyword.toLowerCase();

  // 搜索 frontmatter 部分
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n?---/);
  const fmLineCount = fmMatch ? fmMatch[0].split(/\r?\n/).length : 0;
  if (fmMatch) {
    const fmLines = fmMatch[1].split(/\r?\n/);
    for (let i = 0; i < fmLines.length && snippets.length < MAX_SNIPPETS; i++) {
      if (fmLines[i].toLowerCase().includes(kw)) {
        snippets.push({ field: 'frontmatter', line: i + 2, snippet: fmLines[i].trim() });
      }
    }
  }

  // 搜索正文部分（跳过 frontmatter，去除前导换行避免幻影空行）
  const bodyStart = fmMatch ? fmMatch[0].length : 0;
  const body = content.slice(bodyStart).replace(/^\r?\n/, '');
  const bodyLines = body.split(/\r?\n/);
  for (let i = 0; i < bodyLines.length && snippets.length < MAX_SNIPPETS; i++) {
    const idx = bodyLines[i].toLowerCase().indexOf(kw);
    if (idx !== -1) {
      const start = Math.max(0, idx - CONTEXT_CHARS);
      const end = Math.min(bodyLines[i].length, idx + keyword.length + CONTEXT_CHARS);
      const snippet = (start > 0 ? '...' : '') + bodyLines[i].slice(start, end) + (end < bodyLines[i].length ? '...' : '');
      snippets.push({ field: 'body', line: fmLineCount + i + 1, snippet: snippet.trim() });
    }
  }

  return snippets;
}

// ── 主流程 ─────────────────────────────────────────
const absWikiDir = path.resolve(wikiDir);
try {
  if (!fs.statSync(absWikiDir).isDirectory()) throw 0;
} catch {
  process.stderr.write('Error: --dir must be an existing directory: ' + absWikiDir + '\n');
  process.exit(1);
}

// 类型过滤预计算
let typeDirPrefix = null;
if (typeOpt) {
  typeDirPrefix = TYPE_DIRS[typeOpt];
  if (!typeDirPrefix) {
    process.stderr.write(`Unknown type: ${typeOpt}. Valid: ${Object.keys(TYPE_DIRS).join(', ')}\n`);
    process.exit(1);
  }
  typeDirPrefix += '/';
}

// --type 时只扫描目标子目录，跳过无关文件
const scanBase = typeDirPrefix ? path.join(absWikiDir, typeDirPrefix) : absWikiDir;
const files = scanDir(scanBase, absWikiDir).sort();
const matches = [];
const errors = [];

for (const full of files) {
  const rel = path.relative(absWikiDir, full).replace(/\\/g, '/');
  const ptype = pageType(rel);

  // 类型过滤（scanBase 已缩小范围，此检查为安全兜底）
  if (typeDirPrefix && !rel.startsWith(typeDirPrefix)) continue;

  let content;
  try { content = fs.readFileSync(full, 'utf-8'); }
  catch (e) { errors.push({ path: rel, error: `read failed: ${e.message}` }); continue; }

  // fulltext 模式：搜索 frontmatter 字段 + 正文
  if (fulltextVal !== null) {
    const snippets = fulltextSearch(content, fulltextVal);
    if (snippets.length > 0) {
      const fm = extractFrontmatter(content);
      if (fm && fm.__yaml_parse_error__) {
        errors.push({ path: rel, error: `invalid frontmatter: ${fm.__yaml_parse_error__}` });
      } else {
        matches.push({ path: rel, frontmatter: fm || {}, type: ptype, matches: snippets });
      }
    }
    continue;
  }

  const fm = extractFrontmatter(content);
  if (!fm) { errors.push({ path: rel, error: 'no frontmatter found' }); continue; }
  if (fm.__yaml_parse_error__) { errors.push({ path: rel, error: `invalid frontmatter: ${fm.__yaml_parse_error__}` }); continue; }

  // dump 模式：包含所有有效 frontmatter 的页面
  if (dumpOpt) {
    matches.push({ path: rel, frontmatter: fm, type: ptype });
    continue;
  }

  // 字段过滤（--field 无过滤选项时等同 --not-empty）
  if (fieldOpt) {
    const val = fm[fieldOpt];
    if (containsVal === null && equalsVal === null && !notEmptyOpt) {
      if (val === undefined || val === null) continue;
      if (typeof val === 'string' && val.trim() === '') continue;
      if (Array.isArray(val) && val.length === 0) continue;
    } else if (!matchField(val)) continue;
  }

  matches.push({ path: rel, frontmatter: fm, type: ptype });
}

process.stdout.write(JSON.stringify({ matches, errors }, null, 0) + '\n');
