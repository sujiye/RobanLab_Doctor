'use strict';
/**
 * Roban 泛用故障诊断 workflow（视觉 + 自然语言 + 只读软件证据）。
 *
 * 设计原则：
 *   - 视觉由具备视觉能力的 agent 负责；agent 看图后填写 observations，再传入本 workflow；
 *   - workflow 只做结构化归因、安全动作筛选和报告，不直接执行运动/重启/断电；
 *   - 只读 probe/selfcheck 可选；没有机器人连接时也能基于描述/图片给出候选原因；
 *   - 白名单安全动作（当前 restart-chin-camera）必须 confirm=true 才执行。
 *
 * 用法：
 *   const { TASKS, runTask } = require('./general-diagnosis-workflow.js');
 *   await runTask(ctx, TASKS['roban-general-diagnosis'], {
 *     state: { description: '右臂抬不起来', images: ['/path/a.jpg'], visionObservations: {...} }
 *   });
 */

const path = require('path');
const skills = require('../skills');

const TASKS = {
  'roban-general-diagnosis': {
    id: 'roban-general-diagnosis',
    title: 'Roban 泛用视觉故障诊断',
    scan: true,
    diagnosisDir: path.join(__dirname, '..', 'diagnosis'),
    notes: [
      '视觉 observations 由 agent 看图填写；workflow 不假装能看图',
      '描述/图片/软件证据互相校验',
      '只执行白名单安全动作，且需要用户确认',
      '运动/重启/关节断电/写 offset 一律不自动执行'
    ]
  }
};

const STEPS = [
  {
    id: 'safety',
    title: '执行前安全审查（读取 ATTENTION）',
    skill: 'safety',
    input: () => ({ actions: [], execute: false })
  },
  {
    id: 'intake',
    title: '自然语言故障描述结构化',
    skill: 'symptom-intake',
    input: (task, state) => ({
      description: state.description,
      part: state.part,
      since: state.since,
      recentChanges: state.recentChanges,
      errorText: state.errorText,
      hasImages: (state.images || []).length > 0 || (state.captures || []).length > 0
    })
  },
  {
    id: 'visual',
    title: '视觉证据收集与 observations 校验',
    skill: 'visual-evidence',
    input: (task, state) => ({
      images: state.images || [],
      captures: state.captures || [],
      visionObservations: state.visionObservations || null
    })
  },
  {
    id: 'probe',
    title: '只读基线探测（有机器人连接时）',
    skill: 'env-probe',
    input: (task) => ({ scan: task.scan !== false }),
    when: (task, state) => state.skipProbe !== true
  },
  {
    id: 'selfcheck',
    title: '只读自检证据',
    skill: 'selfcheck',
    input: (task, state) => ({ probe: state.probe }),
    when: (task, state) => Boolean(state.probe)
  },
  {
    id: 'hypotheses',
    title: '多证据归因：描述 + 视觉 + 软件证据',
    skill: 'general-hypothesis',
    input: (task, state) => ({
      description: state.description,
      symptom: state.symptom,
      visualEvidence: state.visualEvidence,
      probe: state.probe,
      checks: state.checks
    })
  },
  {
    id: 'safety-review',
    title: '安全动作审查',
    skill: 'safety',
    input: (task, state) => ({
      actions: (state.safeActions || []).map((item) => item.action),
      execute: state.confirmRepair === true
    }),
    when: (task, state) => Array.isArray(state.safeActions) && state.safeActions.length > 0
  },
  {
    id: 'repair',
    title: '白名单安全动作（默认不执行）',
    skill: 'repair',
    input: (task, state) => ({
      action: (state.safeActions && state.safeActions[0] && state.safeActions[0].action) || null,
      confirm: state.confirmRepair === true
    }),
    when: (task, state) =>
      Array.isArray(state.safeActions) && state.safeActions.length > 0 &&
      state.confirmRepair === true &&
      Boolean(state.safety && state.safety.approved === true)
  },
  {
    id: 'report',
    title: '生成泛用诊断报告',
    skill: 'general-report',
    input: (task, state) => ({
      symptom: state.symptom,
      visualEvidence: state.visualEvidence,
      checks: state.checks || [],
      summary: state.summary || null,
      generalDiagnosis: state.generalDiagnosis || null,
      repair: state.repair || null,
      diagnosisDir: state.diagnosisDir || (task && task.diagnosisDir)
    })
  }
];

async function runTask(ctx, task, opts = {}) {
  const until = opts.until || 'report';
  const state = { ...(opts.state || {}) };
  const results = [];

  for (const step of STEPS) {
    if (step.when && !step.when(task, state)) continue;
    if (opts.skip && opts.skip.includes(step.id)) continue;

    const skill = skills.get(step.skill);
    if (!skill) {
      ctx.log(`[skip] ${step.id} 未注册 skill: ${step.skill}`);
      continue;
    }

    ctx.log(`\n=== [${step.id}] ${step.title} ===`);
    const input = typeof step.input === 'function' ? step.input(task, state) : step.input || {};
    const t0 = Date.now();
    const out = await skill.run(ctx, input);
    if (out && out.state) Object.assign(state, out.state);
    results.push({ step: step.id, ms: Date.now() - t0, out });

    if (until === step.id) break;
  }

  return { task: task.id, state, results };
}

module.exports = { TASKS, STEPS, runTask };
