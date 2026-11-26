'use strict';
/**
 * repair-plan —— 检测完成后的规划阶段：
 *   1) 把检查项归并成故障单元（fault-units）；
 *   2) 逐单元读知识库（kb.findBest / kb.planForUnit）；
 *   3) 产出可执行计划：知识库命中优先，否则按组件安全阶梯自行尝试；
 *   4) 不能自动修复/前置条件不满足的单元只产出人工建议，不进入并行队列。
 *
 * 本阶段完全只读：不执行任何修复。
 */

const path = require('path');
const kb = require('./kb.js');
const faultUnits = require('./fault-units.js');

const id = 'repair-plan';
const title = '故障单元归并 + 知识库检索 + 修复计划';
const description = '返回 units / plans / kbLookups；只读，不执行修复';
const inputs = {
  probe: 'env-probe 输出',
  checks: 'selfcheck 输出',
  findings: 'diagnose findings',
  repairCandidates: 'diagnose repairCandidates',
  kbDir: '知识库目录，默认 <repo>/kb'
};

function resolveKbDir(ctx, provided) {
  return kb.resolveDir(provided || (ctx && ctx.kbDir) || kb.DEFAULT_DIR);
}

async function run(ctx, { probe, checks, findings, repairCandidates, kbDir } = {}) {
  if (!probe) throw new Error('repair-plan 需要 probe');
  const dir = resolveKbDir(ctx, kbDir);

  const units = faultUnits.build({
    probe,
    checks: checks || [],
    findings: findings || [],
    repairCandidates: repairCandidates || []
  });

  const plans = [];
  const kbLookups = [];

  for (const unit of units) {
    const plan = kb.planForUnit(dir, unit, probe);
    plans.push(plan);
    kbLookups.push({
      unitId: unit.id,
      title: unit.title,
      severity: unit.severity,
      checks: unit.checks,
      matched: Boolean(plan.match),
      matchedCaseId: plan.match ? plan.match.caseId : null,
      matchedTitle: plan.match ? plan.match.caseTitle : null,
      score: plan.match ? plan.match.score : null,
      degraded: plan.match ? plan.match.degraded === true : false,
      source: plan.source,
      status: plan.status,
      recurrence: Boolean(plan.recurrence),
      reason: plan.reason || plan.advice || ''
    });
  }

  // 修复成功后短时复发的单元：冷却期内不再自动重启，但要记录这次复发经验
  const recurrences = plans
    .filter((plan) => plan.recurrence && plan.recurrence.caseId)
    .map((plan) => ({
      ...plan.recurrence,
      unitId: plan.unitId,
      component: plan.component,
      unitChecks: plan.unit && plan.unit.checks ? plan.unit.checks : [],
      note: plan.reason
    }));

  const summary = {
    units: units.length,
    ready: plans.filter((plan) => plan.status === 'ready').length,
    blocked: plans.filter((plan) => plan.status === 'blocked').length,
    manual: plans.filter((plan) => plan.status === 'manual').length,
    kbHits: kbLookups.filter((lookup) => lookup.matched).length,
    kbReady: plans.filter((plan) => plan.source === 'kb' && plan.status === 'ready').length,
    generatedReady: plans.filter((plan) => plan.source === 'generated' && plan.status === 'ready').length,
    recurrences: recurrences.length
  };

  ctx.log(
    `[plan] units=${summary.units} ready=${summary.ready} blocked=${summary.blocked} ` +
    `manual=${summary.manual} kb_hits=${summary.kbHits} kb_ready=${summary.kbReady} ` +
    `generated_ready=${summary.generatedReady} recurrences=${summary.recurrences} ` +
    `kb_dir=${path.basename(dir)}`
  );

  return {
    state: { units, plans, kbLookups, planSummary: summary, recurrences, kbDir: dir },
    units,
    plans,
    kbLookups,
    recurrences,
    summary
  };
}

module.exports = { id, title, description, inputs, run, resolveKbDir };
