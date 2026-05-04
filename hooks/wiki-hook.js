#!/usr/bin/env node
'use strict';

/**
 * wiki-hook.js — 统一校验 Hook
 *
 * 按写入文件路径分发校验：
 *   wiki.init.json    → init 临时文件 schema
 *   wiki.ingest.json  → ingest 临时文件 schema
 *   wiki.lint.json    → lint 临时文件 schema
 *   docs/wiki/ (all .md) → frontmatter schema（按目录确定类型）
 *
 * PreToolUse（Write）：阻断无效写入
 * PostToolUse（Edit）：警告，不阻断
 *
 * 退出码：0 = 通过 / 2 = 失败
 */

const fs = require('fs');
const path = require('path');
const jsYaml = require(path.join(__dirname, '..', 'libs', 'js-yaml-4.1.1.min.js'));

// ── 类型目录映射 ────────────────────────────────────
const TYPE_DIR = {
  feature: 'features', module: 'modules', flow: 'flows',
  architecture: 'architectures', query: 'queries'
};

// ── 路由：文件路径 → 校验类型 ───────────────────────
function route(normalized) {
  // 临时文件 — 精确后缀匹配
  if (normalized.endsWith('docs/wiki/wiki.init.json')) return { kind: 'temp', type: 'init' };
  if (normalized.endsWith('docs/wiki/wiki.ingest.json')) return { kind: 'temp', type: 'ingest' };
  if (normalized.endsWith('docs/wiki/wiki.lint.json')) return { kind: 'temp', type: 'lint' };

  // 提取 docs/wiki/ 下的相对路径
  const wikiIdx = normalized.lastIndexOf('docs/wiki/');
  if (wikiIdx === -1) return null;
  const rel = normalized.slice(wikiIdx + 'docs/wiki/'.length);

  // 排除 log.md 和未识别的临时文件
  if (rel === 'log.md') return null;
  if (/^wiki\.\w+\.json$/.test(rel)) return null;

  // index.md
  if (rel === 'index.md') return { kind: 'fm', type: 'index' };

  // 类型目录：精确匹配第一路径段
  const firstSeg = rel.split('/')[0];
  for (const [t, d] of Object.entries(TYPE_DIR)) {
    if (firstSeg === d) return { kind: 'fm', type: t };
  }
  return null;
}

// ── 临时文件校验 ────────────────────────────────────
function validateInit(json) {
  const e = [];
  requireObj(json, e, 'top level');
  if (e.length) return e;
  requireArr(json, 'pending', 'string', e);
  requireArr(json, 'completed', 'string', e);
  if (typeof json.plan !== 'object' || Array.isArray(json.plan)) {
    e.push('plan must be an object');
  } else if (json.plan) {
    for (const [k, v] of Object.entries(json.plan)) {
      if (typeof v !== 'object' || Array.isArray(v)) { e.push(`plan["${k}"] must be an object`); continue; }
      if (typeof v.source !== 'string') e.push(`plan["${k}"].source must be a string`);
      if (!Array.isArray(v.features)) e.push(`plan["${k}"].features must be an array`);
    }
  }
  return e;
}

function validateIngest(json) {
  const e = [];
  requireObj(json, e, 'top level');
  if (e.length) return e;
  if (typeof json.anchor !== 'string') e.push('anchor must be a string');
  requireArr(json, 'changedFiles', 'string', e);
  for (const field of ['pending', 'completed']) {
    if (!Array.isArray(json[field])) { e.push(`${field} must be an array`); continue; }
    for (let i = 0; i < json[field].length; i++) {
      const t = json[field][i];
      if (typeof t !== 'object' || Array.isArray(t)) { e.push(`${field}[${i}] must be an object`); continue; }
      if (typeof t.id !== 'string') e.push(`${field}[${i}].id must be a string`);
      if (t.type !== 'direct' && t.type !== 'indirect') e.push(`${field}[${i}].type must be "direct" or "indirect"`);
      if (typeof t.reason !== 'string') e.push(`${field}[${i}].reason must be a string`);
    }
  }
  return e;
}

function validateLint(json) {
  const e = [];
  requireObj(json, e, 'top level');
  if (e.length) return e;
  if (typeof json.scope !== 'string') e.push('scope must be a string');
  // dimensions
  if (typeof json.dimensions !== 'object' || Array.isArray(json.dimensions)) {
    e.push('dimensions must be an object');
  } else {
    for (const d of ['freshness', 'coverage', 'integrity', 'consistency']) {
      if (!(d in json.dimensions)) e.push(`dimensions missing key: ${d}`);
      else if (json.dimensions[d] !== 'pending' && json.dimensions[d] !== 'completed') {
        e.push(`dimensions.${d} must be "pending" or "completed"`);
      }
    }
  }
  // findings
  if (!Array.isArray(json.findings)) { e.push('findings must be an array'); return e; }
  const severities = new Set(['high', 'medium', 'low']);
  const fixTypes = new Set(['safe', 'content', 'none']);
  for (let i = 0; i < json.findings.length; i++) {
    const f = json.findings[i];
    if (typeof f !== 'object' || Array.isArray(f)) { e.push(`findings[${i}] must be an object`); continue; }
    if (typeof f.dimension !== 'string') e.push(`findings[${i}].dimension must be a string`);
    if (!severities.has(f.severity)) e.push(`findings[${i}].severity must be "high", "medium", or "low"`);
    if (typeof f.page !== 'string') e.push(`findings[${i}].page must be a string`);
    if (typeof f.description !== 'string') e.push(`findings[${i}].description must be a string`);
    if (!fixTypes.has(f.fixType)) e.push(`findings[${i}].fixType must be "safe", "content", or "none"`);
    if (typeof f.fixPlan !== 'string') e.push(`findings[${i}].fixPlan must be a string`);
  }
  return e;
}

// ── Frontmatter 校验 ────────────────────────────────
// 各类型必需字段配置
const FM_REQUIRED = {
  feature:       ['title', 'created', 'updated', 'source', 'tags'],
  module:        ['title', 'created', 'updated', 'features', 'tags'],
  flow:          ['title', 'created', 'updated', 'tags'],
  architecture:  ['title', 'created', 'updated', 'tags'],
  query:         ['title', 'created', 'updated', 'tags'],
  index:         ['title', 'created', 'updated']
};

// 类型命名字段 → 目标目录
const TYPE_FIELDS = {
  features: 'features', modules: 'modules', flows: 'flows'
};

function validateFrontmatter(fm, pageType) {
  const e = [];
  if (typeof fm !== 'object' || Array.isArray(fm)) return ['frontmatter must be an object'];

  const required = FM_REQUIRED[pageType] || [];
  for (const f of required) {
    if (!(f in fm)) e.push(`missing required field: ${f}`);
  }
  if (e.length > 2) return e;

  // ISO 8601 秒级时间戳
  const isoRe = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
  for (const f of ['created', 'updated']) {
    if (f in fm && !isoRe.test(String(fm[f]))) {
      e.push(`invalid ${f}: expected ISO 8601 (e.g. 2026-04-21T14:30:00Z), got "${fm[f]}"`);
    }
  }

  // 数组字段
  for (const f of ['tags', 'guidelines', 'issues']) {
    if (f in fm && !Array.isArray(fm[f])) e.push(`${f} must be an array`);
  }

  // source（feature 专属）
  if ('source' in fm) {
    if (!Array.isArray(fm.source)) {
      e.push('source must be an array');
    } else if (fm.source.length === 0) {
      e.push('source must not be empty');
    } else {
      for (const v of fm.source) {
        if (typeof v !== 'string' || v.trim() === '') e.push(`source elements must be non-empty strings, got "${v}"`);
      }
    }
  }

  // depends（平级引用，同类型目录；index 无目录映射，跳过）
  const myDir = TYPE_DIR[pageType];
  if (myDir && 'depends' in fm) {
    validateLinkArray(fm.depends, 'depends', myDir, e);
  }

  // 类型命名字段（下级引用）
  for (const [field, targetDir] of Object.entries(TYPE_FIELDS)) {
    if (field in fm) {
      validateLinkArray(fm[field], field, targetDir, e);
      // 非空约束（仅当 validateLinkArray 确认是数组后检查）
      if (Array.isArray(fm[field])) {
        if (pageType === 'module' && field === 'features' && fm[field].length === 0) {
          e.push('features must not be empty');
        }
      }
    }
  }

  return e;
}

function validateLinkArray(arr, fieldName, expectedDir, errors) {
  if (!Array.isArray(arr)) { errors.push(`${fieldName} must be an array`); return; }
  const re = new RegExp(`^\\[\\[${expectedDir}/[^/\\]]+\\]\\]$`);
  for (const v of arr) {
    if (typeof v !== 'string' || !re.test(v)) {
      errors.push(`invalid ${fieldName} format: expected [[${expectedDir}/name]], got "${v}"`);
    }
  }
}

// ── 通用辅助 ────────────────────────────────────────
function requireObj(v, errors, ctx) {
  if (typeof v !== 'object' || Array.isArray(v)) errors.push(`${ctx} must be an object`);
}
function requireArr(parent, key, itemType, errors) {
  if (!Array.isArray(parent[key])) { errors.push(`${key} must be an array`); return; }
  if (itemType === 'string') {
    for (let i = 0; i < parent[key].length; i++) {
      if (typeof parent[key][i] !== 'string') errors.push(`${key}[${i}] must be a string`);
    }
  }
}

function extractFrontmatter(content) {
  // 剥离 UTF-8 BOM
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  try { return jsYaml.load(m[1]); }
  catch (e) { return { __error: e.message }; }
}

// ── Hook 入口 ──────────────────────────────────────
async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  if (!input.trim()) process.exit(0);

  let hook;
  try { hook = JSON.parse(input); } catch { process.exit(0); }

  const filePath = (hook.file_path || hook.path || '').replace(/\\/g, '/');
  const r = route(filePath);
  if (!r) process.exit(0);

  // 获取写入内容
  let content = hook.content || hook.new_string || '';
  if (!content && hook.tool_name) {
    try { content = fs.readFileSync(hook.file_path || hook.path, 'utf-8'); }
    catch { process.exit(0); }
  }
  if (!content.trim()) process.exit(0);

  if (r.kind === 'temp') {
    // ── 临时文件校验 ──
    let json;
    try { json = JSON.parse(content); }
    catch (err) { fail(`invalid JSON: ${err.message}`); return; }

    let errors;
    if (r.type === 'init') errors = validateInit(json);
    else if (r.type === 'ingest') errors = validateIngest(json);
    else errors = validateLint(json);

    if (errors.length) fail(`wiki.${r.type}.json validation failed:\n${errors.map(x => '  - ' + x).join('\n')}`);
    else process.exit(0);

  } else {
    // ── Frontmatter 校验 ──
    const fm = extractFrontmatter(content);
    if (!fm) process.exit(0); // 无 frontmatter 的 .md 文件不校验
    if (fm.__error) fail(`invalid YAML frontmatter: ${fm.__error}`);

    const errors = validateFrontmatter(fm, r.type);
    if (errors.length) fail(`frontmatter validation failed (${r.type}):\n${errors.map(x => '  - ' + x).join('\n')}`);
    else process.exit(0);
  }
}

function fail(msg) {
  console.log(msg);
  process.exit(2);
}

main().catch((e) => {
  process.stderr.write(`wiki-hook internal error: ${e.message}\n`);
  process.exit(2);
});
