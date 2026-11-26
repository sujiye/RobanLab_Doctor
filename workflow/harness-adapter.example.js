'use strict';
/**
 * 把 workflow 接到 deepseek harness / 本地 Node 的最小适配示例。
 *
 * 只需要给 ctx 提供：
 *   log(msg, data?)     日志
 *   fs                  Node fs
 *   exec(file,args,opt) 本地命令
 *   remote              { host, user, port?, proxy? }
 *   reportDir           报告输出目录（可选）
 *   kbDir               知识库目录（可选，默认 <repo>/kb）
 *
 * 运行：
 *   ROBAN_HOST=<ROBOT_IP> node workflow/harness-adapter.example.js selfcheck
 *   ROBAN_HOST=<ROBOT_IP> node workflow/harness-adapter.example.js auto
 *   ROBAN_HOST=<ROBOT_IP> node workflow/harness-adapter.example.js auto --confirm
 *   ROBAN_HOST=<ROBOT_IP> node workflow/harness-adapter.example.js repair --confirm
 *
 * 注意：`auto --confirm` / `repair --confirm` 会真正在机器人上执行白名单修复，
 * 并把经验写回知识库；不带 --confirm 时全部为 dry-run，不动机器人、不写知识库。
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { TASKS, runTask, STEPS_AUTO } = require('./workflow.js');
const safety = require('../skills/safety.js');

function makeCtx({ quiet = false } = {}) {
  const host = process.env.ROBAN_HOST || '';
  return {
    log: quiet
      ? () => {}
      : (msg, data) => console.log(data === undefined ? msg : `${msg} ${JSON.stringify(data)}`),
    fs,
    exec: (file, args, opts = {}) => new Promise((resolve, reject) => {
      execFile(file, args, { maxBuffer: 1 << 26, ...opts }, (err, stdout, stderr) => {
        if (err) reject(Object.assign(err, { stdout, stderr }));
        else resolve({ stdout, stderr });
      });
    }),
    remote: {
      host,
      user: process.env.ROBAN_USER || 'lemon',
      port: Number(process.env.ROBAN_PORT || 22),
      proxy: process.env.ROBAN_PROXY || undefined
    },
    secrets: {},
    motionApproved: process.env.ROBAN_MOTION_APPROVED === '1',
    stopPlan: process.env.ROBAN_STOP_PLAN || '',
    reportDir: process.env.ROBAN_REPORT_DIR || path.join(__dirname, '..', 'reports'),
    kbDir: process.env.ROBAN_KB_DIR || path.join(__dirname, '..', 'kb')
  };
}

const MODES = {
  probe: { task: 'roban-selfcheck', until: 'probe' },
  selfcheck: { task: 'roban-selfcheck', until: 'diagnose' },
  diagnose: { task: 'roban-selfcheck', until: 'diagnose' },
  all: { task: 'roban-selfcheck', until: 'report' },
  plan: { task: 'roban-auto-repair', until: 'plan' },
  repair: { task: 'roban-auto-repair', until: 'repair' },
  verify: { task: 'roban-auto-repair', until: 'verify' },
  auto: { task: 'roban-auto-repair', until: 'report' }
};

function usage() {
  console.log([
    '用法: ROBAN_HOST=<用户提供的 IP> [ROBAN_KB_DIR=<dir>] node workflow/harness-adapter.example.js <mode> [--confirm] [--motion-approved]',
    '',
    'mode:',
    '  probe | selfcheck | diagnose | all   # 旧流程：只读自检 / 单动作修复',
    '  plan     # 检测 + 故障分组 + 知识库检索 + 修复计划（只读）',
    '  repair   # 并行修复阶段（默认 dry-run）',
    '  verify   # 修复 + 复检',
    '  auto     # 完整流程：检测 → 知识库 → 并行修复 → 复检 → 写知识库 → 报告',
    '',
    '示例:',
    '  ROBAN_HOST=<ROBOT_IP> node workflow/harness-adapter.example.js auto',
    '  ROBAN_HOST=<ROBOT_IP> node workflow/harness-adapter.example.js auto --confirm',
    '',
    'IP 必须来自用户当前消息；不得从知识库、历史会话或报告读取。'
  ].join('\n'));
}

/**
 * 把 state 压缩成 workflow/脚本可消费的 JSON（不含 probe.raw 等大对象）。
 * 与 `--json` 搭配：stdout 只输出这一行 JSON，便于 subagent 或 workflow 解析。
 */
function summarizeState(state) {
  const compactPlan = (plan) => ({
    unitId: plan.unitId,
    title: plan.title,
    severity: plan.severity,
    status: plan.status,
    source: plan.source,
    caseId: plan.caseId || null,
    caseTitle: plan.caseTitle || null,
    score: plan.score == null ? null : plan.score,
    playbook: plan.playbook || [],
    reason: plan.reason || plan.advice || '',
    recurrence: plan.recurrence || null
  });
  const compactOutcome = (outcome) => ({
    unitId: outcome.unitId,
    component: outcome.component,
    status: outcome.status,
    planSource: outcome.planSource,
    executedSource: outcome.executedSource || null,
    caseId: outcome.caseId || null,
    durationMs: outcome.durationMs,
    attempts: (outcome.attempts || []).map((attempt) => ({
      action: attempt.action,
      attempt: attempt.attempt,
      status: attempt.status
    })),
    failureNote: outcome.failureNote || null,
    targets: outcome.targets || []
  });
  const parallel = state.repairParallel;
  return {
    summary: state.summary || null,
    checks: state.checks || [],
    findings: state.findings || [],
    hypotheses: state.hypotheses || [],
    repairCandidates: state.repairCandidates || [],
    needsUserInput: state.needsUserInput || [],
    units: (state.units || []).map((unit) => ({
      id: unit.id,
      title: unit.title,
      severity: unit.severity,
      checks: unit.checks,
      autoRepairable: unit.autoRepairable,
      manualReason: unit.manualReason,
      targets: unit.targets,
      locks: unit.locks
    })),
    plans: (state.plans || []).map(compactPlan),
    kbLookups: state.kbLookups || [],
    planSummary: state.planSummary || null,
    recurrences: state.recurrences || [],
    repairParallel: parallel
      ? {
          mode: parallel.mode,
          executed: parallel.executed,
          concurrency: parallel.concurrency,
          maxConcurrency: parallel.maxConcurrency,
          durationMs: parallel.durationMs,
          summary: parallel.summary,
          outcomes: (parallel.outcomes || []).map(compactOutcome)
        }
      : null,
    verify: state.verify || null,
    safety: state.safety || null,
    kbWrite: state.kbWrite || null,
    reportPath: state.report && state.report.path ? state.report.path : null
  };
}

function printAutoSummary(state) {
  const plan = state.planSummary;
  const parallel = state.repairParallel;
  if (state.safety) {
    console.log('\n=== 安全审查 ===');
    console.log(JSON.stringify({
      approved: state.safety.approved,
      violations: state.safety.violations,
      motionActions: state.safety.motionActions,
      rules: state.safety.rules ? {
        path: state.safety.rules.path,
        sha256: state.safety.rules.sha256,
        loadedAt: state.safety.rules.loadedAt
      } : null
    }, null, 2));
  }
  if (plan) {
    console.log('\n=== 计划摘要 ===');
    console.log(JSON.stringify(plan, null, 2));
  }
  if (Array.isArray(state.kbLookups) && state.kbLookups.length) {
    console.log('\n=== 知识库检索 ===');
    for (const item of state.kbLookups) {
      console.log(
        `- ${item.unitId} [${item.severity}] KB=${item.matched ? item.matchedCaseId : '未命中'}` +
        ` score=${item.score == null ? '-' : item.score} -> ${item.status}/${item.source}` +
        `${item.degraded ? ' (degraded)' : ''}`
      );
    }
  }
  if (parallel) {
    console.log('\n=== 并行修复结果 ===');
    console.log(JSON.stringify(parallel.summary, null, 2));
    for (const outcome of parallel.outcomes || []) {
      console.log(
        `- ${outcome.unitId}: ${outcome.status}` +
        ` (source=${outcome.executedSource || outcome.planSource || '-'})` +
        `${outcome.failureNote ? ` — ${outcome.failureNote}` : ''}`
      );
    }
  }
  if (state.kbWrite) {
    console.log('\n=== 知识库写入 ===');
    console.log(JSON.stringify({
      skipped: state.kbWrite.skipped === true,
      reason: state.kbWrite.reason,
      skippedOutcomes: state.kbWrite.skippedOutcomes,
      events: state.kbWrite.eventsWritten,
      newCases: state.kbWrite.casesWritten,
      updatedCases: state.kbWrite.casesUpdated
    }, null, 2));
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const jsonOut = argv.includes('--json');
  const mode = argv.find((arg) => !arg.startsWith('--')) || 'selfcheck';
  const confirm = argv.includes('--confirm');
  const ctx = makeCtx({ quiet: jsonOut });
  const route = MODES[mode];
  if (!route) {
    usage();
    process.exit(2);
  }
  if (!ctx.remote.host) {
    console.error('[fatal] 缺少 ROBAN_HOST。请询问用户当前机器人 IP；不得从知识库/历史会话/报告读取。');
    usage();
    process.exit(2);
  }

  // 每次运行入口先读取 ATTENTION；缺失/为空时 safety.loadRules 会抛错并阻止执行。
  const rules = safety.loadRules({ fs });
  const motionApproved = argv.includes('--motion-approved') ||
    process.env.ROBAN_MOTION_APPROVED === '1';
  const stopPlan = process.env.ROBAN_STOP_PLAN || '';

  const task = TASKS[route.task];

  ctx.log(
    `[ctx] robot=${ctx.remote.user}@${ctx.remote.host}:${ctx.remote.port} ` +
    `mode=${mode} confirm=${confirm} motionApproved=${motionApproved} kb=${path.basename(ctx.kbDir)}`
  );
  ctx.log(
    `[safety] ATTENTION loaded ${rules.path} ` +
    `sha256=${rules.sha256.slice(0, 12)} at=${rules.loadedAt}`
  );

  const result = await runTask(ctx, task, {
    until: route.until,
    state: {
      confirmRepair: confirm,
      motionApproved,
      stopPlan
    }
  });

  const state = result.state;
  if (jsonOut) {
    console.log(JSON.stringify({
      task: result.task,
      mode,
      until: route.until,
      ...summarizeState(state)
    }));
    return;
  }
  if (state.report && state.report.markdown) {
    console.log('\n' + state.report.markdown);
  } else if (route.task === 'roban-auto-repair') {
    printAutoSummary(state);
  } else {
    console.log('\n=== 结果摘要 ===');
    console.log(JSON.stringify({
      summary: state.summary,
      findings: state.findings,
      repairCandidates: state.repairCandidates,
      repair: state.repair,
      verify: state.verify
    }, null, 2));
  }

  // 自检发现 FAIL 是正常结果，不让 dsh 把整次运行当成工具失败。
  // 需要严格退出码时设置 ROBAN_STRICT_EXIT=1。
  if (process.env.ROBAN_STRICT_EXIT === '1' && state.summary && state.summary.fail > 0) {
    process.exitCode = 4;
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[fatal]', err.message);
    process.exit(1);
  });
}

module.exports = { makeCtx, MODES, STEPS_AUTO, summarizeState };
