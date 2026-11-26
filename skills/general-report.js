'use strict';
/**
 * general-report —— 泛用视觉诊断报告。
 */

const fsDefault = require('fs');
const path = require('path');

const id = 'general-report';
const title = '泛用故障诊断报告';
const description = '输出自然语言描述、视觉证据、候选原因和下一步';
const inputs = {
  symptom: 'symptom-intake 输出',
  visualEvidence: 'visual-evidence 输出',
  checks: 'selfcheck 输出（可选）',
  summary: 'selfcheck 汇总（可选）',
  generalDiagnosis: 'general-hypothesis 输出',
  repair: 'repair 输出（可选）',
  diagnosisDir: 'string，默认 ./diagnosis'
};

function esc(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function statusLabel(status) {
  return { ok: 'OK', warn: 'WARN', fail: 'FAIL', unknown: 'UNKNOWN' }[status] || String(status || '').toUpperCase();
}

function buildMarkdown({ symptom, visualEvidence, checks, summary, generalDiagnosis, repair }) {
  const lines = [];
  lines.push('# Roban 泛用故障诊断报告');
  lines.push('');
  lines.push(`- 生成时间：${new Date().toISOString()}`);
  lines.push(`- 用户描述：${symptom && symptom.description ? symptom.description : '（未提供）'}`);
  if (symptom && symptom.part) lines.push(`- 部位：${symptom.part}`);
  if (symptom && symptom.since) lines.push(`- 开始时间/频率：${symptom.since}`);
  if (symptom && symptom.recentChanges) lines.push(`- 最近变化：${symptom.recentChanges}`);
  if (symptom && symptom.errorText) lines.push(`- 报错原文：${symptom.errorText}`);
  lines.push('');
  lines.push(`- 症状标签：${(symptom && symptom.tags || []).join('、') || '未识别'}`);
  lines.push(`- 风险等级：${symptom ? symptom.severity : 'unknown'}`);
  if (summary) {
    lines.push(`- 软件自检：OK ${summary.ok} / WARN ${summary.warn} / FAIL ${summary.fail} / UNKNOWN ${summary.unknown}`);
  }
  lines.push('');

  lines.push('## 视觉证据');
  lines.push('');
  const images = (visualEvidence && visualEvidence.images) || [];
  if (!images.length) {
    lines.push('- 没有可用图片；视觉判断缺失。');
  } else {
    for (const image of images) {
      lines.push(`- ${esc(image.label || image.path)}：${image.path}（${image.bytes || 0} bytes）`);
      lines.push(`  ![${esc(image.label || 'image')}](${image.path})`);
    }
  }
  const observations = visualEvidence && visualEvidence.visionObservations;
  if (observations) {
    lines.push('');
    lines.push('### 视觉模型观察（由 agent 看图填写）');
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(observations, null, 2));
    lines.push('```');
  } else {
    lines.push('');
    lines.push('- 还没有视觉 observations；请先看图并按 schema 填写，不能仅凭描述下结论。');
  }
  lines.push('');

  if (checks && checks.length) {
    lines.push('## 软件证据');
    lines.push('');
    lines.push('| 状态 | 检查 | 说明 |');
    lines.push('|---|---|---|');
    for (const check of checks.filter((item) => item.status !== 'ok')) {
      lines.push(`| ${statusLabel(check.status)} | ${esc(check.id)} | ${esc(check.detail)} |`);
    }
    lines.push('');
  }

  lines.push('## 候选原因');
  lines.push('');
  const hypotheses = (generalDiagnosis && generalDiagnosis.hypotheses) || [];
  if (!hypotheses.length) {
    lines.push('- 暂无候选原因，需要补充描述/图片/软件证据。');
  } else {
    lines.push('| 原因 | 类别 | 置信度 | 证据 |');
    lines.push('|---|---|---|---|');
    for (const item of hypotheses) {
      lines.push(
        `| ${esc(item.cause)} | ${esc(item.category)} | ${esc(item.confidence)} | ` +
        `${esc((item.evidence || []).join('；'))} |`
      );
    }
  }
  lines.push('');

  lines.push('## 下一步');
  lines.push('');
  const safeActions = (generalDiagnosis && generalDiagnosis.safeActions) || [];
  if (safeActions.length) {
    lines.push('### 白名单安全动作（需用户确认）');
    lines.push('');
    for (const action of safeActions) {
      lines.push(`- \`${action.action}\`（${action.level}）：${esc(action.reason)}；确认后才会执行。`);
    }
    lines.push('');
  }
  if (generalDiagnosis && generalDiagnosis.recommendedWorkflow) {
    lines.push(`- 推荐 workflow：\`${generalDiagnosis.recommendedWorkflow}\``);
    if (generalDiagnosis.recommendedCommand) {
      lines.push(`- 推荐命令：\`${generalDiagnosis.recommendedCommand}\``);
    }
    lines.push('');
  }
  const manual = [];
  for (const item of hypotheses) {
    for (const action of item.manualActions || []) manual.push(action);
  }
  if (manual.length) {
    lines.push('### 人工检查/操作');
    lines.push('');
    for (const item of [...new Set(manual)]) lines.push(`- ${esc(item)}`);
    lines.push('');
  }
  const needs = (generalDiagnosis && generalDiagnosis.needsUserInput) || [];
  if (needs.length) {
    lines.push('### 还需要补充');
    lines.push('');
    for (const item of needs) lines.push(`- ${esc(item)}`);
    lines.push('');
  }

  if (repair) {
    lines.push('## 已执行的安全动作');
    lines.push('');
    lines.push(`- 动作：${repair.action}`);
    lines.push(`- 状态：${repair.status}${repair.dry_run ? '（dry-run，未执行）' : ''}`);
    if (repair.before) lines.push(`- 执行前：${esc(JSON.stringify(repair.before))}`);
    if (repair.after) lines.push(`- 执行后：${esc(JSON.stringify(repair.after))}`);
    lines.push('');
  }

  lines.push('## 安全说明');
  lines.push('');
  lines.push('- 视觉和自然语言只是证据，不是物理真值；不能仅凭图片断言电机/编码器损坏。');
  lines.push('- agent 不执行运动、不重启机器人、不上电/卸力、不写 offset。');
  lines.push('- 白名单动作必须先得到用户确认；出现冒烟/焦味/跌落时先停止并人工检查。');
  lines.push('- 图片角度、遮挡、光照都会影响判断，报告中保留 uncertainties。');
  lines.push('');
  return lines.join('\n');
}

async function run(ctx, input = {}) {
  const { symptom, visualEvidence, checks, summary, generalDiagnosis, repair, diagnosisDir } = input;
  if (!generalDiagnosis) throw new Error('general-report 需要 generalDiagnosis');
  const markdown = buildMarkdown({ symptom, visualEvidence, checks, summary, generalDiagnosis, repair });
  const fs = ctx.fs || fsDefault;
  const baseDir = diagnosisDir || ctx.diagnosisDir || path.join(process.cwd(), 'diagnosis');
  const dir = path.join(baseDir, 'reports');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filePath = path.join(dir, `general-diagnosis-${stamp}.md`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, markdown, 'utf8');
  } catch (_) { /* still return markdown */ }
  ctx.log(`[general-report] ${filePath}`);
  return { state: { generalReport: { path: filePath, markdown } }, path: filePath, markdown };
}

module.exports = { id, title, description, inputs, run, buildMarkdown };
