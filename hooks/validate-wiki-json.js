#!/usr/bin/env node
/**
 * wiki.json v2 验证 Hook
 *
 * 用途：防止 LLM 写入格式错误或字段缺失的 wiki.json
 *
 * PreToolUse 模式（Write 工具）：验证写入内容，拦截无效写入
 * PostToolUse 模式（Edit 工具）：事后校验完整文件，输出警告
 *
 * 退出码：
 *   0 — 验证通过或不适用于 wiki.json
 *   2 — 验证失败，阻止操作（仅 PreToolUse）
 */

const REQUIRED_FIELDS = [
  'revision',
  'lastUpdated',
  'process',
  'architectures',
  'modules',
  'features'
];

const VALID_PHASES = ['planned', 'filling', 'filled', 'refining', 'completed'];

const MODULE_REQUIRED_FIELDS = ['source', 'features', 'dependencies', 'page'];
const FEATURE_REQUIRED_FIELDS = ['module', 'source', 'page'];

function validateWikiJson(json) {
  const errors = [];

  // 必需字段检查
  for (const field of REQUIRED_FIELDS) {
    if (!(field in json)) {
      errors.push(`缺少必需字段 "${field}"`);
    }
  }

  // 如果缺字段太多，先报缺失，不做进一步检查
  if (errors.length > 2) {
    return errors;
  }

  // revision 类型检查
  if ('revision' in json && (typeof json.revision !== 'number' || !Number.isInteger(json.revision) || json.revision < 1)) {
    errors.push(`revision 必须是正整数，当前值：${JSON.stringify(json.revision)}`);
  }

  // process 结构检查
  if ('process' in json && typeof json.process === 'object' && !Array.isArray(json.process)) {
    if (!('phase' in json.process)) {
      errors.push('process 缺少必需字段 "phase"');
    } else if (typeof json.process.phase === 'string' && !VALID_PHASES.includes(json.process.phase)) {
      errors.push(`process.phase "${json.process.phase}" 不在允许范围内 [${VALID_PHASES.join(', ')}]`);
    }

    // 非 completed 状态时检查 pipeline 字段
    if (json.process.phase !== 'completed') {
      if ('pendingModules' in json.process && !Array.isArray(json.process.pendingModules)) {
        errors.push('process.pendingModules 必须是数组');
      }
      if ('completedModules' in json.process && !Array.isArray(json.process.completedModules)) {
        errors.push('process.completedModules 必须是数组');
      }
    }
  } else if ('process' in json) {
    errors.push('process 必须是对象');
  }

  // architectures 结构检查
  if ('architectures' in json && (typeof json.architectures !== 'object' || Array.isArray(json.architectures))) {
    errors.push('architectures 必须是对象');
  }

  // modules 结构检查
  if ('modules' in json) {
    if (typeof json.modules !== 'object' || Array.isArray(json.modules)) {
      errors.push('modules 必须是对象');
    } else {
      for (const [name, mod] of Object.entries(json.modules)) {
        if (typeof mod !== 'object' || Array.isArray(mod)) {
          errors.push(`modules["${name}"] 必须是对象`);
          continue;
        }
        for (const field of MODULE_REQUIRED_FIELDS) {
          if (!(field in mod)) {
            errors.push(`modules["${name}"] 缺少必需字段 "${field}"`);
          }
        }
        if ('source' in mod && typeof mod.source !== 'string') {
          errors.push(`modules["${name}"].source 必须是字符串`);
        }
        if ('features' in mod && !Array.isArray(mod.features)) {
          errors.push(`modules["${name}"].features 必须是数组`);
        }
        if ('dependencies' in mod && !Array.isArray(mod.dependencies)) {
          errors.push(`modules["${name}"].dependencies 必须是数组`);
        }
        if ('exports' in mod && !Array.isArray(mod.exports)) {
          errors.push(`modules["${name}"].exports 必须是数组`);
        }
        if ('conventions' in mod && !Array.isArray(mod.conventions)) {
          errors.push(`modules["${name}"].conventions 必须是数组`);
        }
      }
    }
  }

  // features 结构检查
  if ('features' in json) {
    if (typeof json.features !== 'object' || Array.isArray(json.features)) {
      errors.push('features 必须是对象');
    } else {
      for (const [name, feat] of Object.entries(json.features)) {
        if (typeof feat !== 'object' || Array.isArray(feat)) {
          errors.push(`features["${name}"] 必须是对象`);
          continue;
        }
        for (const field of FEATURE_REQUIRED_FIELDS) {
          if (!(field in feat)) {
            errors.push(`features["${name}"] 缺少必需字段 "${field}"`);
          }
        }
        if ('module' in feat && typeof feat.module !== 'string') {
          errors.push(`features["${name}"].module 必须是字符串`);
        }
        if ('source' in feat && !Array.isArray(feat.source)) {
          errors.push(`features["${name}"].source 必须是数组`);
        }
        if ('imports' in feat && !Array.isArray(feat.imports)) {
          errors.push(`features["${name}"].imports 必须是数组`);
        }
      }
    }
  }

  // flows 结构检查（可选段）
  if ('flows' in json) {
    if (typeof json.flows !== 'object' || Array.isArray(json.flows)) {
      errors.push('flows 必须是对象');
    } else {
      for (const [name, flow] of Object.entries(json.flows)) {
        if (typeof flow !== 'object' || Array.isArray(flow)) {
          errors.push(`flows["${name}"] 必须是对象`);
          continue;
        }
        if (!('modules' in flow)) {
          errors.push(`flows["${name}"] 缺少必需字段 "modules"`);
        } else if (!Array.isArray(flow.modules)) {
          errors.push(`flows["${name}"].modules 必须是数组`);
        }
        if (!('page' in flow)) {
          errors.push(`flows["${name}"] 缺少必需字段 "page"`);
        }
      }
    }
  }

  return errors;
}

function isWikiJsonPath(filePath) {
  if (!filePath) return false;
  return filePath.replace(/\\/g, '/').endsWith('docs/wiki/wiki.json');
}

async function main() {
  let input = '';

  // 从 stdin 读取 hook 输入
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  if (!input.trim()) {
    process.exit(0);
  }

  let hookInput;
  try {
    hookInput = JSON.parse(input);
  } catch {
    // 无法解析输入，放行
    process.exit(0);
  }

  // 提取文件路径
  const filePath = hookInput.file_path || hookInput.path || '';
  if (!isWikiJsonPath(filePath)) {
    process.exit(0);
  }

  // 提取内容
  let content = hookInput.content || hookInput.new_string || '';

  // PostToolUse 模式：content 可能为空，直接读取文件验证
  if (!content && hookInput.tool_name) {
    try {
      const fs = await import('fs');
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      // 文件不存在或无法读取，放行
      process.exit(0);
    }
  }

  if (!content.trim()) {
    process.exit(0);
  }

  // 解析 JSON
  let json;
  try {
    json = JSON.parse(content);
  } catch (e) {
    console.log(`wiki.json 验证失败：内容不是有效的 JSON — ${e.message}`);
    process.exit(2);
  }

  // 验证
  const errors = validateWikiJson(json);
  if (errors.length > 0) {
    console.log(`wiki.json 验证失败：\n${errors.map(e => `  - ${e}`).join('\n')}`);
    process.exit(2);
  }

  process.exit(0);
}

main().catch(() => process.exit(0));
