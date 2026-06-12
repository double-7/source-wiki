#!/usr/bin/env node
'use strict';

/**
 * wiki-utils.js — wiki-hook.js 与 query-wiki.js 的共享工具
 *
 * 统一：类型目录映射、frontmatter 提取、js-yaml 加载。
 */

const path = require('path');
const jsYaml = require(path.join(__dirname, 'js-yaml-4.1.1.min.js'));

// ── 类型 → 目录映射 ─────────────────────────────────
const TYPE_DIRS = {
  feature: 'features', module: 'modules', flow: 'flows',
  architecture: 'architectures', query: 'queries'
};

// ── 目录 → 类型映射（反向查询） ──────────────────────
const DIR_TYPES = {};
for (const [t, d] of Object.entries(TYPE_DIRS)) DIR_TYPES[d] = t;

// ── Frontmatter 提取 ────────────────────────────────
function extractFrontmatter(content) {
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n?---/);
  if (!m) return null;
  try {
    const r = jsYaml.load(m[1], { schema: jsYaml.JSON_SCHEMA });
    if (r === undefined || r === null) return {};
    if (typeof r !== 'object' || Array.isArray(r)) return {};
    return r;
  }
  catch (e) { return { __yaml_parse_error__: e.message }; }
}

module.exports = { jsYaml, TYPE_DIRS, DIR_TYPES, extractFrontmatter };
