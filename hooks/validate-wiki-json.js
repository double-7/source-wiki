#!/usr/bin/env node
/**
 * wiki.json 验证 Hook
 *
 * 校验 wiki.json 知识索引结构（不校验操作特异的 process 子字段）。
 *
 * PreToolUse（Write）：验证写入内容，拦截无效写入
 * PostToolUse（Edit）：事后校验完整文件，输出警告
 *
 * 退出码：0 = 通过 / 2 = 失败（PreToolUse 阻止，PostToolUse 警告）
 */

const REQUIRED_FIELDS = ['revision', 'lastUpdated', 'process', 'modules', 'features'];

const MODULE_REQUIRED = ['source', 'features', 'page'];
const FEATURE_REQUIRED = ['source', 'page'];

function validate(json) {
  const errors = [];

  // 必需字段
  for (const f of REQUIRED_FIELDS) {
    if (!(f in json)) errors.push(`缺少必需字段 "${f}"`);
  }
  if (errors.length > 2) return errors;

  // revision
  if ('revision' in json && (typeof json.revision !== 'number' || !Number.isInteger(json.revision) || json.revision < 1)) {
    errors.push(`revision 必须是正整数，当前值：${JSON.stringify(json.revision)}`);
  }

  // process
  if ('process' in json && typeof json.process === 'object' && !Array.isArray(json.process)) {
    if (!('phase' in json.process)) {
      errors.push('process 缺少 "phase"');
    }
  } else if ('process' in json) {
    errors.push('process 必须是对象');
  }

  // modules
  if ('modules' in json) {
    if (typeof json.modules !== 'object' || Array.isArray(json.modules)) {
      errors.push('modules 必须是对象');
    } else {
      for (const [name, mod] of Object.entries(json.modules)) {
        if (typeof mod !== 'object' || Array.isArray(mod)) {
          errors.push(`modules["${name}"] 必须是对象`);
          continue;
        }
        for (const f of MODULE_REQUIRED) {
          if (!(f in mod)) errors.push(`modules["${name}"] 缺少 "${f}"`);
        }
        if ('source' in mod && typeof mod.source !== 'string') errors.push(`modules["${name}"].source 必须是字符串`);
        if ('features' in mod && !Array.isArray(mod.features)) errors.push(`modules["${name}"].features 必须是数组`);
      }
    }
  }

  // features
  if ('features' in json) {
    if (typeof json.features !== 'object' || Array.isArray(json.features)) {
      errors.push('features 必须是对象');
    } else {
      for (const [name, feat] of Object.entries(json.features)) {
        if (typeof feat !== 'object' || Array.isArray(feat)) {
          errors.push(`features["${name}"] 必须是对象`);
          continue;
        }
        for (const f of FEATURE_REQUIRED) {
          if (!(f in feat)) errors.push(`features["${name}"] 缺少 "${f}"`);
        }
        if ('source' in feat && !Array.isArray(feat.source)) errors.push(`features["${name}"].source 必须是数组`);
      }
    }
  }

  // flows（可选）
  if ('flows' in json) {
    if (typeof json.flows !== 'object' || Array.isArray(json.flows)) {
      errors.push('flows 必须是对象');
    } else {
      for (const [name, flow] of Object.entries(json.flows)) {
        if (typeof flow !== 'object' || Array.isArray(flow)) {
          errors.push(`flows["${name}"] 必须是对象`);
          continue;
        }
        if (!('modules' in flow)) errors.push(`flows["${name}"] 缺少 "modules"`);
        else if (!Array.isArray(flow.modules)) errors.push(`flows["${name}"].modules 必须是数组`);
        if (!('page' in flow)) errors.push(`flows["${name}"] 缺少 "page"`);
      }
    }
  }

  return errors;
}

function isWikiJsonPath(p) {
  return p && p.replace(/\\/g, '/').endsWith('docs/wiki/wiki.json');
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  if (!input.trim()) process.exit(0);

  let hook;
  try { hook = JSON.parse(input); } catch { process.exit(0); }

  const path = hook.file_path || hook.path || '';
  if (!isWikiJsonPath(path)) process.exit(0);

  let content = hook.content || hook.new_string || '';
  if (!content && hook.tool_name) {
    try {
      const fs = await import('fs');
      content = fs.readFileSync(path, 'utf-8');
    } catch { process.exit(0); }
  }
  if (!content.trim()) process.exit(0);

  let json;
  try { json = JSON.parse(content); } catch (e) {
    console.log(`wiki.json 验证失败：内容不是有效的 JSON — ${e.message}`);
    process.exit(2);
  }

  const errors = validate(json);
  if (errors.length > 0) {
    console.log(`wiki.json 验证失败：\n${errors.map(e => `  - ${e}`).join('\n')}`);
    process.exit(2);
  }
  process.exit(0);
}

main().catch(() => process.exit(0));
