'use strict';
/**
 * repair-parallel —— 并行执行修复计划。
 *
 *   - 每个故障单元一个执行任务，默认并发 3（ROBAN_REPAIR_CONCURRENCY 可调）；
 *   - 每个单元声明资源锁（locks），相同资源的单元自动串行，避免抢同一条链路；
 *   - 知识库优先：source=kb 时执行知识库剧本；剧本失败后用组件安全阶梯「自行尝试」；
 *   - 默认 dry-run：只做前置检查并返回计划，不写机器人、不写知识库。
 *
 * 安全边界：这里的 action 全部来自 repair 白名单；本模块不拼任意 shell。
 */

const repair = require('./repair.js');
const safety = require('./safety.js');

const id = 'repair-parallel';
const title = '并行修复（知识库优先，失败后自行尝试）';
const description = '按故障单元并行执行；资源锁串行化同一链路；默认 dry-run';
const inputs = {
  plans: 'repair-plan 输出的 plans',
  confirm: 'boolean，true 才真正执行；默认 false（dry-run）',
  concurrency: 'number，默认 3'
};

const ABORT_PREFIX = 'aborted';

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function defaultExecuteAction(ctx, action, options) {
  return repair.run(ctx, {
    action,
    confirm: options && options.confirm === true
  });
}

/* ------------------------------------------------------------------ *
 * 并发/锁
 * ------------------------------------------------------------------ */

function createSemaphore(limit) {
  let active = 0;
  const queue = [];
  return {
    async acquire() {
      if (active < limit) {
        active += 1;
        return;
      }
      await new Promise((resolve) => queue.push(resolve));
      active += 1;
    },
    release() {
      active -= 1;
      const next = queue.shift();
      if (next) next();
    },
    get active() {
      return active;
    }
  };
}

function createLockTable() {
  const tails = new Map();
  function withLock(key, fn) {
    const prev = tails.get(key) || Promise.resolve();
    const run = prev.then(fn, fn);
    tails.set(key, run.catch(() => {}));
    return run;
  }
  /**
   * 按固定顺序获取多个锁（避免死锁），执行完自动释放。
   */
  function runWithLocks(keys, fn) {
    const unique = [...new Set((keys || []).filter(Boolean))].sort();
    const nested = unique.reduceRight(
      (inner, key) => () => withLock(key, inner),
      fn
    );
    return nested();
  }
  return { runWithLocks };
}

/* ------------------------------------------------------------------ *
 * 单元执行
 * ------------------------------------------------------------------ */

function outcomeBase(plan) {
  const unit = plan.unit || {};
  return {
    unitId: plan.unitId,
    component: plan.component,
    title: plan.title,
    severity: plan.severity,
    planSource: plan.source,
    caseId: plan.caseId || null,
    targets: (plan.targets || []).slice(),
    unitChecks: (unit.checks || []).slice(),
    unitPredicates: (unit.predicates || []).slice(),
    unitKeywords: (unit.keywords || []).slice(),
    unitPreconditions: unit.preconditions || null,
    verification: unit.verification || null,
    attempts: [],
    usedPlaybook: [],
    kbPlaybookStatus: null,
    executedSource: null
  };
}

function planForManual(plan) {
  return {
    ...outcomeBase(plan),
    status: plan.status === 'manual' ? 'manual_required' : 'blocked',
    reason: plan.reason || plan.advice || '',
    durationMs: 0,
    dry_run: false
  };
}

/**
 * 执行一个修复单元。
 *
 * 返回 status: success | failed | blocked | dry_run | manual_required
 */
async function executeUnit(ctx, plan, {
  confirm = false,
  executeAction = defaultExecuteAction,
  sleep = defaultSleep,
  motionApproved = false,
  stopPlan = ''
} = {}) {
  const startedAt = Date.now();
  const outcome = outcomeBase(plan);
  outcome.safety = null;

  if (!plan || plan.status === 'manual' || plan.status === 'blocked') {
    return planForManual(plan || {});
  }

  const unit = plan.unit || {};
  const playbook = Array.isArray(plan.playbook) ? plan.playbook : [];
  const fallbackPlaybook = Array.isArray(unit.generatedPlaybook) && unit.generatedPlaybook.length
    ? unit.generatedPlaybook
    : [];

  // 每次执行前重新读取 ATTENTION，并审查知识库/自行尝试的全部动作。
  const gate = safety.reviewActions(
    [...playbook, ...fallbackPlaybook].map((step) => step && step.action),
    {
      ctx,
      execute: confirm,
      motionApproved: motionApproved === true || ctx.motionApproved === true,
      stopPlan: stopPlan || ctx.stopPlan || ''
    }
  );
  if (!gate.approved) {
    const reason = gate.violations.map((item) => `${item.action}: ${item.reason}`).join('；');
    return {
      ...outcome,
      status: 'blocked',
      failureNote: `安全审查未通过：${reason}`,
      safety: gate,
      durationMs: Date.now() - startedAt
    };
  }
  if (gate.motionActions.length) {
    ctx.log('[repair][safety-motion] ' + gate.stopInstructions);
  }
  outcome.safety = gate;

  async function runPlaybook(steps, phase) {
    for (const step of steps) {
      const retries = confirm ? Math.max(0, Number(step.retries || 0)) : 0;
      const tries = 1 + retries;
      for (let attempt = 1; attempt <= tries; attempt += 1) {
        const actionOut = await executeAction(ctx, step.action, { confirm, plan, step });
        const status = actionOut && actionOut.status;
        outcome.attempts.push({
          phase,
          action: step.action,
          attempt,
          status: status || 'unknown',
          dry_run: Boolean(actionOut && actionOut.dry_run),
          before: actionOut && actionOut.before,
          after: actionOut && actionOut.after,
          exit_code: actionOut && actionOut.exit_code,
          logTail: actionOut && actionOut.log_tail ? String(actionOut.log_tail).slice(-1200) : ''
        });
        if (status === 'success' || status === 'noop_already_running') {
          return { ok: true, action: step.action, status };
        }
        if (status === 'failed' || status === 'skipped' || !status) {
          if (attempt < tries) {
            await sleep(step.retryDelayMs || 3000);
            continue;
          }
          return { ok: false, action: step.action, status: status || 'unknown' };
        }
        // aborted_* 或未知状态：立即停止，不再尝试后续步骤
        return {
          ok: false,
          action: step.action,
          status,
          aborted: String(status).startsWith(ABORT_PREFIX)
        };
      }
    }
    return { ok: false, action: null, status: 'no_attempt' };
  }

  // dry-run：只做一次前置检查（repair 脚本在 APPLY=0 时不会写机器人）
  if (!confirm) {
    const first = playbook[0];
    if (!first) {
      return {
        ...outcome,
        status: 'failed',
        failureNote: '计划没有可执行步骤',
        durationMs: Date.now() - startedAt
      };
    }
    const actionOut = await executeAction(ctx, first.action, { confirm: false, plan, step: first });
    outcome.attempts.push({
      phase: 'dry-run',
      action: first.action,
      attempt: 1,
      status: (actionOut && actionOut.status) || 'unknown',
      dry_run: true,
      before: actionOut && actionOut.before,
      after: actionOut && actionOut.after,
      exit_code: actionOut && actionOut.exit_code
    });
    return {
      ...outcome,
      status: 'dry_run',
      dry_run: true,
      durationMs: Date.now() - startedAt,
      plannedPlaybook: playbook
    };
  }

  if (plan.source === 'kb') {
    const kbRun = await runPlaybook(playbook, 'kb');
    outcome.kbPlaybookStatus = kbRun.ok ? 'success' : 'failed';
    if (kbRun.ok) {
      outcome.status = 'success';
      outcome.executedSource = 'kb';
      outcome.usedPlaybook = playbook;
      outcome.durationMs = Date.now() - startedAt;
      outcome.verification = { ...(unit.verification || {}), reported: true };
      return outcome;
    }
    if (kbRun.aborted) {
      outcome.status = 'blocked';
      outcome.executedSource = 'kb';
      outcome.failureNote = `执行中被安全条件中止：${kbRun.status}`;
      outcome.durationMs = Date.now() - startedAt;
      return outcome;
    }
    // 知识库剧本失败 → 自行尝试
    if (fallbackPlaybook.length) {
      const fallback = await runPlaybook(fallbackPlaybook, 'generated');
      outcome.executedSource = 'kb+fallback';
      outcome.usedPlaybook = fallbackPlaybook;
      outcome.status = fallback.ok ? 'success' : 'failed';
      outcome.failureNote = fallback.ok
        ? `知识库剧本失败（${kbRun.status}），自行尝试成功`
        : `知识库剧本失败（${kbRun.status}），自行尝试仍失败（${fallback.status}）`;
      outcome.durationMs = Date.now() - startedAt;
      outcome.verification = { ...(unit.verification || {}), reported: fallback.ok };
      return outcome;
    }
    outcome.status = 'failed';
    outcome.executedSource = 'kb';
    outcome.usedPlaybook = playbook;
    outcome.failureNote = `知识库剧本失败（${kbRun.status}），且该组件无自行尝试阶梯`;
    outcome.durationMs = Date.now() - startedAt;
    return outcome;
  }

  // source = generated：直接自行尝试
  const run = await runPlaybook(playbook, 'generated');
  outcome.executedSource = 'generated';
  outcome.usedPlaybook = playbook;
  outcome.status = run.ok ? 'success' : run.aborted ? 'blocked' : 'failed';
  outcome.durationMs = Date.now() - startedAt;
  outcome.verification = { ...(unit.verification || {}), reported: run.ok };
  if (!run.ok) outcome.failureNote = `自行尝试失败：${run.status}`;
  return outcome;
}

/* ------------------------------------------------------------------ *
 * 并行编排
 * ------------------------------------------------------------------ */

function summarize(outcomes, mode) {
  const summary = {
    total: outcomes.length,
    success: 0,
    failed: 0,
    blocked: 0,
    manual_required: 0,
    dry_run: 0
  };
  for (const outcome of outcomes) {
    if (summary[outcome.status] !== undefined) summary[outcome.status] += 1;
  }
  summary.mode = mode;
  return summary;
}

async function executePlans(ctx, plans = [], opts = {}) {
  const confirm = opts.confirm === true;
  const defaultConcurrency = Number(process.env.ROBAN_REPAIR_CONCURRENCY || 3);
  const concurrency = Math.max(1, Number(opts.concurrency || defaultConcurrency) || 3);
  const executeAction = opts.executeAction || defaultExecuteAction;
  const sleep = opts.sleep || defaultSleep;
  const motionApproved = opts.motionApproved === true;
  const stopPlan = opts.stopPlan || '';

  const semaphore = createSemaphore(concurrency);
  const lockTable = createLockTable();
  const outcomes = new Array(plans.length);
  const startedAt = Date.now();
  let active = 0;
  let maxConcurrency = 0;

  await Promise.all(
    plans.map(async (plan, index) => {
      if (!plan) {
        outcomes[index] = {
          unitId: 'unknown',
          status: 'blocked',
          reason: '计划为空',
          attempts: [],
          durationMs: 0
        };
        return;
      }
      if (plan.status === 'manual' || plan.status === 'blocked') {
        outcomes[index] = planForManual(plan);
        return;
      }
      await semaphore.acquire();
      active += 1;
      if (active > maxConcurrency) maxConcurrency = active;
      try {
        outcomes[index] = await lockTable.runWithLocks(plan.locks, () =>
          executeUnit(ctx, plan, { confirm, executeAction, sleep, motionApproved, stopPlan })
        );
      } catch (err) {
        outcomes[index] = {
          ...outcomeBase(plan),
          status: 'failed',
          failureNote: `执行异常：${err.message}`,
          durationMs: Date.now() - startedAt
        };
      } finally {
        active -= 1;
        semaphore.release();
      }
    })
  );

  const result = {
    mode: confirm ? 'apply' : 'dry_run',
    executed: confirm,
    concurrency,
    maxConcurrency,
    startedAt: new Date(startedAt).toISOString(),
    durationMs: Date.now() - startedAt,
    outcomes,
    summary: summarize(outcomes, confirm ? 'apply' : 'dry_run')
  };
  return result;
}

async function run(ctx, {
  plans = [],
  confirm = false,
  concurrency,
  motionApproved = false,
  stopPlan = ''
} = {}) {
  const result = await executePlans(ctx, plans, {
    confirm,
    concurrency,
    motionApproved,
    stopPlan
  });
  ctx.log(
    `[repair] mode=${result.mode} total=${result.summary.total} ` +
    `success=${result.summary.success} failed=${result.summary.failed} ` +
    `blocked=${result.summary.blocked} manual=${result.summary.manual_required} ` +
    `dry_run=${result.summary.dry_run} max_concurrency=${result.maxConcurrency} ` +
    `duration=${result.durationMs}ms`
  );
  return {
    state: { repairParallel: result, repairs: result.outcomes },
    ...result
  };
}

module.exports = {
  id,
  title,
  description,
  inputs,
  run,
  executePlans,
  executeUnit,
  createSemaphore,
  createLockTable,
  defaultExecuteAction
};
