'use strict';
/**
 * Roban 零位标定 workflow（人工在环）。
 *
 * 目标：解决“软件读不出来”的关节零点偏移。
 *
 * 边界：
 *   - 只读取 offset、计算候选、生成本地补丁/apply 脚本；
 *   - 不写机器人 offset、不重启 BodyHub、不让关节上电/卸力/运动；
 *   - 手机相机只是人工测量辅助，必须由用户确认；
 *   - apply 脚本和 BodyHub 重启都由用户手动完成。
 *
 * 用法：
 *   const { runTask, TASKS } = require('./calibration-workflow.js');
 *   await runTask(ctx, TASKS['roban-zero-calibration'], {
 *     state: { jointId: 7, expectedAngle: 0, actualAngle: 3.2, sign: 1 }
 *   });
 */

const path = require('path');
const skills = require('../skills');

const TASKS = {
  'roban-zero-calibration': {
    id: 'roban-zero-calibration',
    title: 'Roban 零位偏移标定（人工在环 + 手机测量）',
    calibrationDir: path.join(__dirname, '..', 'calibration'),
    notes: [
      '不自动写 offset；只生成补丁和 apply 脚本',
      'apply 和 BodyHub 重启必须由用户手动完成',
      '运动/卸力/断电一律不允许自动执行'
    ]
  }
};

const STEPS = [
  {
    id: 'safety',
    title: '执行前安全审查（读取 ATTENTION）',
    skill: 'safety',
    input: () => ({
      actions: ['read-offsets', 'prepare-offset-patch', 'verify-offset'],
      execute: false
    })
  },
  {
    id: 'plan',
    title: '标定规划：关节 / offset 层 / 测量方法',
    skill: 'calibration-plan',
    input: (task, state) => ({
      jointId: state.jointId,
      layer: state.layer,
      expectedAngle: state.expectedAngle,
      actualAngle: state.actualAngle,
      captureFile: state.captureFile,
      sign: state.sign,
      note: state.note
    })
  },
  {
    id: 'measure',
    title: '读取人工/手机测量，计算偏差',
    skill: 'calibration-measure',
    input: (task, state) => ({
      jointId: state.jointId,
      expectedAngle: state.expectedAngle,
      actualAngle: state.actualAngle,
      captureFile: state.captureFile,
      capturesDir: path.join(task.calibrationDir || state.calibrationDir || 'calibration', 'captures')
    }),
    when: (task, state) => state.calibrationPlan && state.calibrationPlan.status !== 'blocked'
  },
  {
    id: 'prepare',
    title: '读取当前 offset，生成候选值、备份、patch、apply 脚本',
    skill: 'calibration-offset',
    input: (task, state) => ({
      jointId: state.jointId,
      layer: state.layer || 'pose',
      delta: state.calibrationMeasurement && state.calibrationMeasurement.delta,
      sign: state.calibrationPlan ? state.calibrationPlan.sign : state.sign,
      calibrationDir: state.calibrationDir || (task && task.calibrationDir)
    }),
    when: (task, state) =>
      Boolean(state.calibrationMeasurement && state.calibrationMeasurement.status === 'ready') &&
      Boolean(state.calibrationPlan && state.calibrationPlan.status !== 'blocked')
  },
  {
    id: 'verify',
    title: '用户手动 apply 后复检 offset',
    skill: 'calibration-verify',
    input: (task, state) => ({
      jointId: state.jointId,
      layer: state.layer || 'pose',
      expectedOffset: state.calibrationOffset && state.calibrationOffset.candidateOffset
    }),
    when: (task, state) =>
      state.calibrationApplied === true && Boolean(state.calibrationOffset)
  },
  {
    id: 'report',
    title: '生成零位标定记录',
    skill: 'calibration-report',
    input: (task, state) => ({
      plan: state.calibrationPlan,
      measurement: state.calibrationMeasurement,
      offset: state.calibrationOffset,
      verify: state.calibrationVerify || null,
      calibrationDir: state.calibrationDir || (task && task.calibrationDir)
    }),
    when: (task, state) => Boolean(state.calibrationPlan && state.calibrationMeasurement && state.calibrationOffset)
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
