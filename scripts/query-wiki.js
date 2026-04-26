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
 */

const fs = require('fs');
const path = require('path');
const jsYaml = require(path.join(__dirname, '..', 'libs', 'js-yaml-4.1.1.min.js'));

// ── 类型 ↔ 目录映射 ────────────────────────────────
const TYPE_DIRS = {
  feature: 'features', module: 'modules', flow: 'flows',
  architecture: 'architectures', query: 'queries'
};
const DIR_TYPES = {};
for (const [t, d] of Object.entries(TYPE_DIRS)) DIR_TYPES[d] = t;

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

if (!wikiDir) {
  process.stderr.write('Usage: query-wiki.js --dir <wiki-dir> [options]\n');
  process.exit(1);
}

// ── Frontmatter 提取 ───────────────────────────────
function extractFrontmatter(content) {
  // Strip UTF-8 BOM if present
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  try { return jsYaml.load(m[1]); }
  catch (e) { return { __error: e.message }; }
}

// ── 递归扫描 .md 文件（排除 log.md） ───────────────
function scanDir(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...scanDir(full));
    } else if (entry.name.endsWith('.md') && entry.name !== 'log.md') {
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
  if (containsVal !== null) {
    if (Array.isArray(value)) return value.some(v => String(v).includes(containsVal));
    if (typeof value === 'string') return value.includes(containsVal);
    return false;
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

// ── 主流程 ─────────────────────────────────────────
const absWikiDir = path.resolve(wikiDir);
const files = scanDir(absWikiDir);
const matches = [];
const errors = [];

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

for (const full of files) {
  const rel = path.relative(absWikiDir, full).replace(/\\/g, '/');
  const ptype = pageType(rel);

  // 类型过滤
  if (typeDirPrefix && !rel.startsWith(typeDirPrefix)) continue;

  let content;
  try { content = fs.readFileSync(full, 'utf-8'); }
  catch (e) { errors.push({ path: rel, error: `read failed: ${e.message}` }); continue; }

  const fm = extractFrontmatter(content);
  if (!fm) { errors.push({ path: rel, error: 'no frontmatter found' }); continue; }
  if (fm.__error) { errors.push({ path: rel, error: `invalid frontmatter: ${fm.__error}` }); continue; }

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
      if (Array.isArray(val) && val.length === 0) continue;
    } else if (!matchField(val)) continue;
  }

  matches.push({ path: rel, frontmatter: fm, type: ptype });
}

process.stdout.write(JSON.stringify({ matches, errors }, null, 0) + '\n');
