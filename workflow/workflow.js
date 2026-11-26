'use strict';
/**
 * Roban workflow。
 *
 * 两个任务：
 *   roban-selfcheck —— 只读自检 + 单动作安全修复（旧流程，保持兼容）
 *   roban-auto-repair —— 检测 → 故障分组 → 知识库检索 → 并行修复（KB 优先，失败自行尝试）
 *                        → 整体复检 → 经验写回知识库 → 报告
 *
 * 设计原则
 *  1) 只依赖 ctx 适配对象（见 harness-adapter.example.js），不绑定具体框架；
 *  2) 检测全部只读；修复只走 repair 白名单，默认 dry-run，需显式 confirm；
 *  3) 知识库只存经验，不存任意命令；剧本动作必须命中白名单；
 *  4) 多个故障按组件归并成修复单元，并行执行；同资源单元用锁串行；
 *  5) 修复后必须整体复检，复检结果决定经验是否有效。
 */

const path = require('path');
const skills = require('../skills');

const TASKS = {
  'roban-selfcheck': {
    id: 'roban-selfcheck',
    title: 'Roban 只读自检与安全修复',
    scan: true,
    repairAction: 'restart-chin-camera',
    reportDir: path.join(__dirname, '..', 'reports'),
    notes: [
      '默认只读；repair 阶段默认 dry-run',
      '只有 state.confirmRepair=true 才真正执行重启',
      '修复后 verify 阶段会重跑同一套检查'
    ]
  },
  'roban-auto-repair': {
    id: 'roban-auto-repair',
    title: 'Roban 自动检测 + 知识库修复 + 并行执行 + 经验回写',
    scan: true,
    reportDir: path.join(__dirname, '..', 'reports'),
    notes: [
      '检测 → 故障单元 → 读知识库 → 并行修复 → 复检 → 写知识库 → 报告',
      '知识库命中优先按经验修复；未命中或经验失败则自行尝试',
      '默认 dry-run；只有 state.confirmRepair=true 才真正执行并写知识库',
      '同组件故障合并为一个单元，不同组件并行，同资源用锁串行'
    ]
  }
};

const STEPS = [
  {
    id: 'safety',
    title: '执行前安全审查（读取 ATTENTION/ATTENTION.md）',
    skill: 'safety',
    input: (task, state) => ({
      actions: (state.repairCandidates || []).map((item) => item.action),
      motionApproved: state.motionApproved === true,
      stopPlan: state.stopPlan || ''
    })
  },
  {
    id: 'probe',
    title: '只读基线探测（主机 / ROS / BodyHub / 舵机 / 传感器 / 日志）',
    skill: 'env-probe',
    input: (task) => ({ scan: task.scan !== false })
  },
  {
    id: 'selfcheck',
    title: '规则化自检判定',
    skill: 'selfcheck',
    input: (task, state) => ({ probe: state.probe })
  },
  {
    id: 'baseline',
    title: '官方基线对照（机型/版本/开机/零点/硬件/官方自检）',
    skill: 'official-baseline',
    input: (task, state) => ({ probe: state.probe, checks: state.checks })
  },
  {
    id: 'diagnose',
    title: '归因、候选原因与修复候选',
    skill: 'diagnose',
    input: (task, state) => ({ probe: state.probe, checks: state.checks })
  },
  {
    id: 'safety-review',
    title: '修复前安全审查（动作分类 + 运动批准 + 停止方式）',
    skill: 'safety',
    input: (task, state) => ({
      actions: (state.repairCandidates || []).map((item) => item.action),
      motionApproved: state.motionApproved === true,
      stopPlan: state.stopPlan || '',
      execute: state.confirmRepair === true
    }),
    when: (task, state) =>
      Array.isArray(state.repairCandidates) && state.repairCandidates.length > 0
  },
  {
    id: 'repair',
    title: '白名单修复（默认 dry-run）',
    skill: 'repair',
    input: (task, state) => ({
      action: (state.repairCandidates && state.repairCandidates[0] && state.repairCandidates[0].action)
        || task.repairAction,
      confirm: state.confirmRepair === true
    }),
    when: (task, state) =>
      Array.isArray(state.repairCandidates) && state.repairCandidates.length > 0 &&
      Boolean(state.safety && state.safety.approved === true)
  },
  {
    id: 'verify',
    title: '修复后复检与前后对比',
    skill: 'verify',
    input: (task, state) => ({
      beforeChecks: state.checks,
      scan: true,
      targets: ['camera_chin', 'chin_camera_node']
    }),
    when: (task, state) => state.repair && state.repair.status === 'success'
  },
  {
    id: 'report',
    title: '生成 Markdown 报告',
    skill: 'report',
    input: (task, state) => ({
      probe: state.probe,
      checks: state.checks,
      summary: state.summary,
      diagnosis: {
        findings: state.findings || [],
        hypotheses: state.hypotheses || [],
        repairCandidates: state.repairCandidates || [],
        needsUserInput: state.needsUserInput || []
      },
      repair: state.repair || null,
      verify: state.verify || null,
      safety: state.safety || null,
      baseline: state.baseline || null
    })
  }
];

/** 修复后整体复检的目标：所有实际执行过（成功/失败）的单元目标 + 人工单元不参与 */
function collectPlanActions(plans) {
  const actions = [];
  for (const plan of plans || []) {
    for (const step of (plan && plan.playbook) || []) {
      if (step && step.action) actions.push(step.action);
    }
    const generated = plan && plan.unit && plan.unit.generatedPlaybook;
    for (const step of generated || []) {
      if (step && step.action) actions.push(step.action);
    }
  }
  return [...new Set(actions)];
}

function verifyTargetsFromState(state) {
  const targets = [];
  const outcomes = (state.repairParallel && state.repairParallel.outcomes) || [];
  for (const outcome of outcomes) {
    if (!outcome || (outcome.status !== 'success' && outcome.status !== 'failed')) continue;
    for (const target of outcome.targets || []) {
      if (!targets.includes(target)) targets.push(target);
    }
  }
  return targets;
}

const STEPS_AUTO = [
  {
    id: 'safety',
    title: '执行前安全审查（读取 ATTENTION/ATTENTION.md）',
    skill: 'safety',
    input: (task, state) => ({
      actions: collectPlanActions(state.plans || []),
      motionApproved: state.motionApproved === true,
      stopPlan: state.stopPlan || ''
    })
  },
  {
    id: 'probe',
    title: '连接机器人 + 只读基线探测',
    skill: 'env-probe',
    input: (task) => ({ scan: task.scan !== false })
  },
  {
    id: 'selfcheck',
    title: '初始检测：规则化自检',
    skill: 'selfcheck',
    input: (task, state) => ({ probe: state.probe })
  },
  {
    id: 'baseline',
    title: '初始检测：官方基线对照（规格/版本/开机/零点/硬件）',
    skill: 'official-baseline',
    input: (task, state) => ({ probe: state.probe, checks: state.checks })
  },
  {
    id: 'diagnose',
    title: '初始检测：归因与候选原因',
    skill: 'diagnose',
    input: (task, state) => ({ probe: state.probe, checks: state.checks })
  },
  {
    id: 'plan',
    title: '故障分组 + 知识库检索 + 修复计划',
    skill: 'repair-plan',
    input: (task, state) => ({
      probe: state.probe,
      checks: state.checks,
      findings: state.findings || [],
      repairCandidates: state.repairCandidates || [],
      kbDir: state.kbDir
    })
  },
  {
    id: 'safety-review',
    title: '修复前安全审查（知识库/自行尝试动作 + 运动批准 + 停止方式）',
    skill: 'safety',
    input: (task, state) => ({
      actions: collectPlanActions(state.plans || []),
      motionApproved: state.motionApproved === true,
      stopPlan: state.stopPlan || '',
      execute: state.confirmRepair === true
    }),
    when: (task, state) => Array.isArray(state.plans) && state.plans.length > 0
  },
  {
    id: 'repair',
    title: '并行修复（知识库优先，失败后自行尝试）',
    skill: 'repair-parallel',
    input: (task, state) => ({
      plans: state.plans || [],
      confirm: state.confirmRepair === true,
      motionApproved: state.motionApproved === true,
      stopPlan: state.stopPlan || ''
    }),
    when: (task, state) =>
      Array.isArray(state.plans) && state.plans.length > 0 &&
      Boolean(state.safety && state.safety.approved === true)
  },
  {
    id: 'verify',
    title: '修复后整体复检（重新采集证据并对比）',
    skill: 'verify',
    input: (task, state) => ({
      beforeChecks: state.checks,
      scan: true,
      targets: verifyTargetsFromState(state)
    }),
    when: (task, state) =>
      Boolean(state.repairParallel && state.repairParallel.executed) &&
      verifyTargetsFromState(state).length > 0
  },
  {
    id: 'learn',
    title: '经验写回知识库（成功与失败都记录）',
    skill: 'learn',
    input: (task, state) => ({
      outcomes: (state.repairParallel && state.repairParallel.outcomes) || [],
      recurrences: state.recurrences || [],
      verify: state.verify || null,
      probe: state.probe,
      confirm: state.confirmRepair === true,
      kbDir: state.kbDir
    }),
    when: (task, state) =>
      Boolean(state.repairParallel && state.repairParallel.executed) ||
      (Array.isArray(state.recurrences) && state.recurrences.length > 0)
  },
  {
    id: 'report',
    title: '生成 Markdown 报告',
    skill: 'report',
    input: (task, state) => ({
      probe: state.probe,
      checks: state.checks,
      summary: state.summary,
      diagnosis: {
        findings: state.findings || [],
        hypotheses: state.hypotheses || [],
        repairCandidates: state.repairCandidates || [],
        needsUserInput: state.needsUserInput || []
      },
      repair: null,
      verify: state.verify || null,
      safety: state.safety || null,
      auto: {
        kbDir: state.kbDir,
        planSummary: state.planSummary || null,
        plans: state.plans || [],
        kbLookups: state.kbLookups || [],
        repairParallel: state.repairParallel || null,
        recurrences: state.recurrences || [],
        kbWrite: state.kbWrite || null
      }
    })
  }
];

function stepsForTask(task) {
  if (Array.isArray(task.steps)) return task.steps;
  return task.id === 'roban-auto-repair' ? STEPS_AUTO : STEPS;
}

async function runTask(ctx, task, opts = {}) {
  const until = opts.until || 'report';
  const state = { ...(opts.state || {}) };
  if (ctx && ctx.kbDir && !state.kbDir) state.kbDir = ctx.kbDir;
  const results = [];
  const steps = stepsForTask(task);

  for (const step of steps) {
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

module.exports = {
  TASKS, STEPS, STEPS_AUTO, stepsForTask, runTask,
  verifyTargetsFromState, collectPlanActions
};
