'use strict';
/**
 * verify —— 修复后复检：重新采集同一套只读证据，并与修复前的 checks 对比。
 */

const envProbe = require('./env-probe.js');
const selfcheck = require('./selfcheck.js');

const id = 'verify';
const title = '修复后复检与前后对比';
const description = '重新运行 env-probe + selfcheck，返回状态变化和修复目标是否通过';
const inputs = {
  beforeChecks: 'array，修复前 selfcheck 的 checks',
  scan: 'boolean，默认 true',
  targets: 'array，默认 [camera_chin, chin_camera_node]'
};

function summaryOf(checks) {
  const summary = { ok: 0, warn: 0, fail: 0, unknown: 0 };
  for (const c of checks || []) {
    if (summary[c.status] !== undefined) summary[c.status] += 1;
  }
  return summary;
}

async function run(ctx, {
  beforeChecks = [],
  scan = true,
  targets = ['camera_chin', 'chin_camera_node']
} = {}) {
  const probeOut = await envProbe.run(ctx, { scan });
  const checkOut = await selfcheck.run(ctx, { probe: probeOut.probe });

  const before = new Map((beforeChecks || []).map((c) => [c.id, c]));
  const changes = [];
  for (const after of checkOut.checks) {
    const prev = before.get(after.id);
    if (prev && prev.status !== after.status) {
      changes.push({
        id: after.id,
        before: prev.status,
        after: after.status,
        detail: after.detail
      });
    }
  }

  const targetChecks = targets.map((targetId) => {
    const c = checkOut.checks.find((item) => item.id === targetId);
    return { id: targetId, status: c ? c.status : 'missing', detail: c ? c.detail : '检查项不存在' };
  });
  const verified = targetChecks.every((c) => c.status === 'ok');

  const result = {
    before_summary: summaryOf(beforeChecks),
    after_summary: checkOut.summary,
    changes,
    targets: targetChecks,
    verified
  };

  ctx.log(
    `[verify] verified=${verified} changes=` +
    changes.map((c) => `${c.id}:${c.before}->${c.after}`).join(',')
  );

  return {
    state: { verify: result },
    probe: probeOut.probe,
    checks: checkOut.checks,
    ...result
  };
}

module.exports = { id, title, description, inputs, run, summaryOf };
