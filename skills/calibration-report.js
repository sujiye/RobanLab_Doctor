'use strict';
/**
 * calibration-report —— 零位标定记录（Markdown）。
 */

const fsDefault = require('fs');
const path = require('path');

const id = 'calibration-report';
const title = '零位标定报告';
const description = '输出标定记录、候选 offset、补丁/apply 路径和人工步骤';
const inputs = {
  plan: 'calibration-plan 输出',
  measurement: 'calibration-measure 输出',
  offset: 'calibration-offset 输出',
  verify: 'calibration-verify 输出（可选）'
};

function esc(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function buildMarkdown({ plan, measurement, offset, verify }) {
  const lines = [];
  lines.push('# Roban 零位标定记录');
  lines.push('');
  lines.push(`- 关节：ID${plan.jointId}`);
  lines.push(`- offset 层：${plan.layer}（${plan.layerPath}）`);
  lines.push(`- 期望角度：${plan.expectedAngle}°`);
  lines.push(`- 实测角度：${measurement.actualAngle}°（来源：${measurement.source}）`);
  lines.push(`- 偏差 delta：${measurement.delta}°`);
  lines.push(`- 修正方向 sign：${plan.sign}`);
  lines.push(`- 当前 offset：${offset.currentOffset}`);
  lines.push(`- 候选 offset：${offset.candidateOffset}`);
  lines.push('');
  lines.push('## 风险提示');
  lines.push('');
  if (plan.warnings && plan.warnings.length) {
    for (const warning of plan.warnings) lines.push(`- ${esc(warning)}`);
  } else {
    lines.push('- 无额外警告；仍需人工确认测量和方向。');
  }
  lines.push('');
  lines.push('## 生成的文件');
  lines.push('');
  lines.push(`- 备份：${offset.backupPath}`);
  lines.push(`- 补丁：${offset.patchPath}`);
  lines.push(`- apply 脚本：${offset.applyScriptPath}`);
  lines.push('');
  lines.push('## 人工 apply（必须由用户执行）');
  lines.push('');
  lines.push('1. 确认机器人已支撑，手臂不会因卸力/误动作跌落。');
  lines.push('2. 把 apply 脚本复制到机器人并运行：');
  lines.push('');
  lines.push('```bash');
  lines.push(offset.applyCommand);
  lines.push('```');
  lines.push('');
  lines.push('3. 脚本只修改 offset 文件并备份；不会重启 BodyHub、不会断电、不会移动关节。');
  lines.push('4. 由用户手动重启 BodyHub（或按厂家流程重新加载 offset）。');
  lines.push('5. 重新把关节放到同一参考姿态，复测并运行 verify。');
  lines.push('');
  lines.push('## 人工步骤');
  lines.push('');
  for (const step of plan.humanSteps) lines.push(`- ${esc(step)}`);
  lines.push('');
  if (verify) {
    lines.push('## 复检');
    lines.push('');
    lines.push(`- 当前 offset：${verify.currentOffset}`);
    lines.push(`- 期望 offset：${verify.expectedOffset}`);
    lines.push(`- 文件值匹配：${verify.matches}`);
    lines.push('- 仍需人工视觉确认关节是否回到参考姿态。');
    lines.push('');
  }
  lines.push('## 测量说明');
  lines.push('');
  lines.push(`- 人工：${measurement.source === 'manual' ? '角度尺/数字水平仪' : '手机相机页面'}`);
  if (measurement.captureFile) lines.push(`- 测量文件：${measurement.captureFile}`);
  lines.push('- 单张手持手机照片不能给出绝对零位；手机必须固定，画面中要有基座参考线/标记。');
  lines.push('- 若偏差随方向/负载变化，优先检查舵机臂齿位、连杆和装配，而不是继续加大 offset。');
  lines.push('');
  return lines.join('\n');
}

async function run(ctx, {
  plan,
  measurement,
  offset,
  verify = null,
  calibrationDir
} = {}) {
  if (!plan || !measurement || !offset) {
    throw new Error('calibration-report 需要 plan、measurement、offset');
  }
  const markdown = buildMarkdown({ plan, measurement, offset, verify });
  const fs = ctx.fs || fsDefault;
  const baseDir = calibrationDir || path.join(process.cwd(), 'calibration');
  const dir = path.join(baseDir, 'reports');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filePath = path.join(dir, `zero-calibration-ID${plan.jointId}-${stamp}.md`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, markdown, 'utf8');
  } catch (_) { /* 仍返回 markdown */ }

  ctx.log(`[calibration-report] ${filePath}`);
  return { state: { calibrationReport: { path: filePath, markdown } }, path: filePath, markdown };
}

module.exports = { id, title, description, inputs, run, buildMarkdown };
