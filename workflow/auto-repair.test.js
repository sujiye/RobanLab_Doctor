'use strict';
/**
 * 自动修复 workflow 的单元测试（零依赖，node:test）。
 *
 * 运行：node --test workflow/auto-repair.test.js
 *
 * 覆盖：
 *   1) 故障分组：同一根因的多条检查项合并成一个单元；
 *   2) 知识库命中 → 计划走 kb；知识库为空 → 计划走 generated；
 *   3) 知识库剧本失败 → 自动回退自行尝试，并记录 kbPlaybookStatus=failed；
 *   4) 多单元并行执行；同资源锁串行；manual/blocked 不执行；
 *   5) learn：写入事件日志、更新命中案例统计、自动习得新案例；
 *   6) 复检失败时不记成功；连续失败标记 degraded；
 *   7) 剧本动作必须在白名单内。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const selfcheck = require('../skills/selfcheck.js');
const diagnose = require('../skills/diagnose.js');
const faultUnits = require('../skills/fault-units.js');
const kb = require('../skills/kb.js');
const repairPlan = require('../skills/repair-plan.js');
const repairParallel = require('../skills/repair-parallel.js');
const learn = require('../skills/learn.js');
const report = require('../skills/report.js');
const envProbe = require('../skills/env-probe.js');

const REPO = path.join(__dirname, '..');
const SEED_CASE = path.join(REPO, 'kb', 'cases', 'camera-chin-startup-order.json');
/** 官方手册的结构化基线（由 knowledge/manuals/ 的 PDF 文本层抽取，每条带 citation）。 */
const OFFICIAL_BASELINE = JSON.parse(
  fs.readFileSync(path.join(REPO, 'knowledge', 'official-baseline.json'), 'utf8')
);

const silentCtx = { log() {}, kbDir: null };

function tempDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
}

function seedKb(dir) {
  fs.mkdirSync(path.join(dir, 'cases'), { recursive: true });
  // 从真实 KB 复制种子案例，但把统计重置，保证测试不依赖线上运行历史
  const seed = JSON.parse(fs.readFileSync(SEED_CASE, 'utf8'));
  seed.stats = { attempts: 0, successes: 0, failures: 0, lastOutcome: null, lastAttemptAt: null };
  delete seed.degraded;
  delete seed.lastFailure;
  delete seed.lastEvidence;
  delete seed.replaces;
  delete seed.recurrences;
  delete seed.lastRecurrence;
  seed.cooldownMs = 900000;
  fs.writeFileSync(
    path.join(dir, 'cases', 'camera-chin-startup-order.json'),
    JSON.stringify(seed, null, 2),
    'utf8'
  );
  fs.writeFileSync(path.join(dir, 'events.jsonl'), '', 'utf8');
}

/** 与 2026-11-19 基线一致的合成 probe（下巴相机故障，其余正常）。
 *  官方基线字段（机型/版本/开机自启/零点/USB/麦克风/topic 覆盖）取自 knowledge/CHECKMAP.md，
 *  默认设为「健康」，只保留相机故障，这样归因层只会产出 camera.chin / servo.* / sensor.* 单元。 */
function baselineProbe(overrides = {}) {
  const nodes = selfcheck.EXPECTED_NODES.filter((node) => node !== '/chin_camera');
  const probe = {
    host: 'test-host',
    ip: 'test-ip',
    time: '2026-11-19 10:00:00 +0800',
    sshOk: true,
    sshExitCode: 0,
    diskUsedPct: 37,
    memAvailMb: 2000,
    usbServo: 'OK',
    usbCam: 'OK',
    videoNodeCount: 3,
    rosMaster: 'OK',
    nodeCount: nodes.length,
    nodes,
    // 官方基线：《Roban机器人版本查询手册》p.1-2（仓库时间 2024-06-12 > 2023-11-29；20.04 → Roban 2.0）
    osRelease: 'Ubuntu 20.04 LTS',
    robotModel: 'Roban 2.0',
    rosDistro: 'noetic',
    uptimeSeconds: 3600,
    repo: { dir: 'OK', commitDate: '2024-06-12', commit: '9f2c1ab' },
    // 《Roban开机无法自动进入系统》p.1 / 《Roban_教员培训手册》p.59-60
    boot: {
      lightdm: 'OK',
      autologinUser: 'lemon',
      autologinTimeout: '0',
      startScript: 'OK',
      roscoreProcs: 3
    },
    // 《Roban查零点步骤》p.1
    zeroPoint: { officialOffset: 'OK', officialOffsetLines: 24, stairOffset: 'OK' },
    chinLaunch: 'OK',
    usb: { realsense: 'OK', deviceCount: 7 },
    // 《Roban机器人自检手册》p.1-2：check 程序存在，但脚底压感项没有可读 topic（需人工跑 check）
    officialCheck: { path: '/usr/bin/check', size: 8123, items: ['脚底压感测试', '舵机温度'] },
    topics: {
      count: 148,
      footPressure: [],
      sensorHub: ['/MediumSize/SensorHub/BatteryState', '/MediumSize/SensorHub/Temperature']
    },
    bodyhubServices: 12,
    bodyhubNode: 'OK',
    bodyhubState: 'preReady',
    poseQueue: 0,
    jointQueue: 0,
    masterId: 0,
    jointAngles: new Array(22).fill(0),
    jointCount: 22,
    temperatures: [41, 38, 40, 0, 39],
    tempZeroIds: [4],
    servoScanIds: Array.from({ length: 22 }, (_, i) => i + 1),
    servoScanRaw: '[1, 2, 3]',
    rates: {
      cameraColor: 16.6,
      chinCamera: null,
      battery: 20,
      imuTorso: null,
      sensorTemperature: null,
      micWakeup: 1.4,
      bodyhubStatus: 2.0
    },
    battery: { voltage: 12.2, percentage: 0, present: 'True' },
    chinCameraNode: 'UNREACHABLE',
    realsenseNode: 'OK',
    logs: {
      dxlBulkReadErrors: 16,
      timerTimeouts: 0,
      roslogErrors: 0,
      masterUnreachableLogs: 0,
      deadProcesses: 1,
      deadProcessNames: 'chin_camera-3'
    }
  };
  return Object.assign(probe, overrides);
}

function detect(probe = baselineProbe()) {
  const checks = selfcheck.evaluate(probe).checks;
  const summary = selfcheck.evaluate(probe).summary;
  const diagnosis = diagnose.build(probe, checks);
  return { probe, checks, summary, ...diagnosis };
}

async function planFor(dir, probe = baselineProbe()) {
  const detected = detect(probe);
  const out = await repairPlan.run(
    { log() {}, kbDir: dir },
    {
      probe: detected.probe,
      checks: detected.checks,
      findings: detected.findings,
      repairCandidates: detected.repairCandidates,
      kbDir: dir
    }
  );
  return { ...detected, ...out };
}

function fakeActionSequence(statuses) {
  let index = 0;
  const calls = [];
  const fn = async (ctx, action, options) => {
    calls.push({ action, confirm: options && options.confirm });
    const status = statuses[Math.min(index, statuses.length - 1)];
    index += 1;
    return {
      action,
      status,
      dry_run: !(options && options.confirm),
      before: { bodyhub_state: 'preReady', master_id: 0, usb_cam: 'OK' },
      after: { node_started: status === 'success', rate_hz: status === 'success' ? 16 : null },
      exit_code: status === 'success' ? 0 : 7,
      log_tail: ''
    };
  };
  fn.calls = calls;
  return fn;
}

/* ------------------------------------------------------------------ *
 * 1) 故障分组
 * ------------------------------------------------------------------ */

test('故障分组：下巴相机的多条检查项合并成一个 camera.chin 单元', () => {
  const detected = detect();
  const units = faultUnits.build(detected);
  const camera = units.find((unit) => unit.id === 'camera.chin');
  assert.ok(camera, '应存在 camera.chin 单元');
  assert.ok(camera.checks.includes('camera_chin'));
  assert.ok(camera.checks.includes('chin_camera_node'));
  assert.ok(camera.checks.includes('expected_nodes'));
  assert.equal(camera.checks.filter((id) => id === 'expected_nodes').length, 1, 'expected_nodes 只出现一次');
  assert.equal(camera.autoRepairable, true);
  assert.deepEqual(camera.locks.slice(0, 1), ['camera.chin']);
  // 同一 expected_nodes 不会单独成单元
  assert.equal(units.filter((unit) => unit.id === 'system.nodes').length, 0);
});

/* ------------------------------------------------------------------ *
 * 2) 知识库命中 / 未命中
 * ------------------------------------------------------------------ */

test('知识库命中：相机单元计划走 kb，其它单元为人工建议', async () => {
  const dir = tempDir('roban-kb-hit');
  try {
    seedKb(dir);
    const planned = await planFor(dir);
    const camera = planned.plans.find((plan) => plan.unitId === 'camera.chin');
    assert.equal(camera.source, 'kb');
    assert.equal(camera.status, 'ready');
    assert.equal(camera.caseId, 'camera-chin-startup-order');
    assert.deepEqual(camera.playbook, [{ action: 'restart-chin-camera', note: '非运动节点重启；随后要求 /chin_camera/image ≥ 5 Hz 持续 5 秒' }]);
    assert.ok(planned.plans.every((plan) => plan.status !== 'manual' || plan.unitId !== 'camera.chin'));
    const bus = planned.plans.find((plan) => plan.unitId === 'servo.bus');
    assert.equal(bus.status, 'manual');
    assert.ok(bus.advice.includes('供电'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('知识库未命中：计划走 generated 并带安全阶梯', async () => {
  const dir = tempDir('roban-kb-miss');
  try {
    const planned = await planFor(dir);
    const camera = planned.plans.find((plan) => plan.unitId === 'camera.chin');
    assert.equal(camera.status, 'ready');
    assert.equal(camera.source, 'generated');
    assert.equal(camera.caseId, null);
    assert.ok(camera.playbook.length >= 1);
    assert.equal(camera.playbook[0].action, 'restart-chin-camera');
    assert.equal(planned.plans.filter((plan) => plan.status === 'manual').length > 0, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('前置条件不满足（BodyHub walking）：相机计划被阻止，不执行', async () => {
  const dir = tempDir('roban-kb-blocked');
  try {
    seedKb(dir);
    const probe = baselineProbe({ bodyhubState: 'walking' });
    const planned = await planFor(dir, probe);
    const camera = planned.plans.find((plan) => plan.unitId === 'camera.chin');
    assert.equal(camera.status, 'blocked');
    assert.match(camera.reason, /前置条件/);

    const executed = await repairParallel.executePlans(silentCtx, planned.plans, {
      confirm: true,
      executeAction: fakeActionSequence(['success'])
    });
    const blocked = executed.outcomes.find((outcome) => outcome.unitId === 'camera.chin');
    assert.equal(blocked.status, 'blocked');
    assert.equal(blocked.attempts.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ *
 * 3) 知识库剧本失败 → 自行尝试回退
 * ------------------------------------------------------------------ */

test('知识库剧本失败后回退自行尝试并成功', async () => {
  const dir = tempDir('roban-kb-fallback');
  try {
    seedKb(dir);
    const planned = await planFor(dir);
    const cameraPlan = planned.plans.find((plan) => plan.unitId === 'camera.chin');
    const executeAction = fakeActionSequence(['failed', 'success']);

    const outcome = await repairParallel.executeUnit(
      silentCtx,
      cameraPlan,
      { confirm: true, executeAction, sleep: async () => {} }
    );

    assert.equal(outcome.status, 'success');
    assert.equal(outcome.executedSource, 'kb+fallback');
    assert.equal(outcome.kbPlaybookStatus, 'failed');
    assert.deepEqual(outcome.attempts.map((attempt) => attempt.phase), ['kb', 'generated']);
    assert.deepEqual(outcome.attempts.map((attempt) => attempt.status), ['failed', 'success']);
    assert.deepEqual(outcome.usedPlaybook, faultUnits.COMPONENTS['camera.chin'].generatedPlaybook);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('dry-run 不执行写动作，只做一次前置检查', async () => {
  const dir = tempDir('roban-kb-dryrun');
  try {
    seedKb(dir);
    const planned = await planFor(dir);
    const cameraPlan = planned.plans.find((plan) => plan.unitId === 'camera.chin');
    const executeAction = fakeActionSequence(['dry_run']);

    const result = await repairParallel.executePlans(silentCtx, planned.plans, {
      confirm: false,
      executeAction
    });
    const camera = result.outcomes.find((outcome) => outcome.unitId === 'camera.chin');
    assert.equal(camera.status, 'dry_run');
    assert.equal(camera.attempts.length, 1);
    assert.equal(executeAction.calls.length, 1);
    assert.equal(executeAction.calls[0].confirm, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ *
 * 4) 并行 + 锁
 * ------------------------------------------------------------------ */

function makePlan(unitId, locks, status = 'ready') {
  return {
    unitId,
    component: unitId,
    title: unitId,
    severity: 'warn',
    status,
    source: 'generated',
    caseId: null,
    targets: [],
    locks,
    playbook: [{ action: 'restart-chin-camera' }],
    unit: { checks: [], generatedPlaybook: [] }
  };
}

test('并行执行：不同资源锁的两个单元同时执行', async () => {
  let active = 0;
  let maxActive = 0;
  const executeAction = async () => {
    active += 1;
    if (active > maxActive) maxActive = active;
    await new Promise((resolve) => setTimeout(resolve, 60));
    active -= 1;
    return { status: 'success' };
  };
  const result = await repairParallel.executePlans(
    silentCtx,
    [makePlan('a', ['resource.a']), makePlan('b', ['resource.b'])],
    { confirm: true, concurrency: 2, executeAction }
  );
  assert.equal(result.summary.success, 2);
  assert.equal(maxActive, 2);
  assert.equal(result.maxConcurrency, 2);
});

test('同资源锁串行：共享锁的单元不会同时执行', async () => {
  let active = 0;
  let maxActive = 0;
  const executeAction = async () => {
    active += 1;
    if (active > maxActive) maxActive = active;
    await new Promise((resolve) => setTimeout(resolve, 40));
    active -= 1;
    return { status: 'success' };
  };
  await repairParallel.executePlans(
    silentCtx,
    [makePlan('a', ['shared.lock']), makePlan('b', ['shared.lock'])],
    { confirm: true, concurrency: 2, executeAction }
  );
  assert.equal(maxActive, 1);
});

test('manual / blocked 单元不进入执行队列', async () => {
  let called = 0;
  const executeAction = async () => {
    called += 1;
    return { status: 'success' };
  };
  const result = await repairParallel.executePlans(
    silentCtx,
    [makePlan('manual-a', [], 'manual'), makePlan('blocked-b', [], 'blocked'), makePlan('ready-c', [], 'ready')],
    { confirm: true, executeAction }
  );
  assert.equal(called, 1);
  assert.equal(result.outcomes[0].status, 'manual_required');
  assert.equal(result.outcomes[1].status, 'blocked');
  assert.equal(result.outcomes[2].status, 'success');
});

/* ------------------------------------------------------------------ *
 * 5) learn：知识库写入
 * ------------------------------------------------------------------ */

test('learn：更新命中案例、自动习得新案例、写事件日志', async () => {
  const dir = tempDir('roban-kb-learn');
  const ctx = { log() {}, kbDir: dir };
  try {
    seedKb(dir);
    const planned = await planFor(dir);
    const cameraPlan = planned.plans.find((plan) => plan.unitId === 'camera.chin');
    const outcome = await repairParallel.executeUnit(ctx, cameraPlan, {
      confirm: true,
      executeAction: fakeActionSequence(['failed', 'success']),
      sleep: async () => {}
    });

    const verify = {
      targets: [
        { id: 'camera_chin', status: 'ok' },
        { id: 'chin_camera_node', status: 'ok' },
        { id: 'expected_nodes', status: 'ok' }
      ]
    };
    const write = await learn.run(ctx, {
      outcomes: [outcome],
      verify,
      probe: planned.probe,
      confirm: true,
      kbDir: dir
    });

    assert.equal(write.kbWrite.skipped, undefined);
    assert.deepEqual(write.kbWrite.skippedOutcomes, []);
    assert.equal(write.kbWrite.eventsWritten, 1);
    assert.equal(write.kbWrite.casesWritten.length, 1);
    assert.equal(write.kbWrite.casesUpdated.length, 1);

    const events = fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').trim().split('\n');
    assert.equal(events.length, 1);
    const event = JSON.parse(events[0]);
    assert.equal(event.kind, 'repair-attempt');
    assert.equal(event.component, 'camera.chin');
    assert.equal(event.executedSource, 'kb+fallback');
    assert.equal(event.kbPlaybookStatus, 'failed');
    assert.equal(event.effective, true);

    const seed = kb.loadCaseById(dir, 'camera-chin-startup-order');
    assert.equal(seed.stats.attempts, 1);
    assert.equal(seed.stats.failures, 1);
    assert.equal(seed.stats.successes, 0);

    const learnedId = write.kbWrite.casesWritten[0];
    assert.match(learnedId, /^learned-camera-chin-/);
    const learned = kb.loadCaseById(dir, learnedId);
    assert.equal(learned.source, 'learned');
    assert.equal(learned.component, 'camera.chin');
    assert.equal(learned.stats.successes, 1);
    assert.deepEqual(learned.playbook, faultUnits.COMPONENTS['camera.chin'].generatedPlaybook);
    assert.equal(learned.replaces, 'camera-chin-startup-order');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('learn：复检失败不记成功，连续失败标记 degraded', async () => {
  const dir = tempDir('roban-kb-degraded');
  const ctx = { log() {}, kbDir: dir };
  try {
    seedKb(dir);
    const failingOutcome = {
      unitId: 'camera.chin',
      component: 'camera.chin',
      title: '下巴相机链路',
      planSource: 'kb',
      executedSource: 'kb',
      caseId: 'camera-chin-startup-order',
      kbPlaybookStatus: 'success',
      status: 'success',
      targets: ['camera_chin', 'chin_camera_node'],
      attempts: [{ action: 'restart-chin-camera', attempt: 1, status: 'success' }],
      usedPlaybook: [{ action: 'restart-chin-camera' }],
      durationMs: 10
    };
    const verifyFail = { targets: [
      { id: 'camera_chin', status: 'fail' },
      { id: 'chin_camera_node', status: 'warn' }
    ] };

    await learn.run(ctx, { outcomes: [failingOutcome], verify: verifyFail, probe: baselineProbe(), confirm: true, kbDir: dir });
    let seed = kb.loadCaseById(dir, 'camera-chin-startup-order');
    assert.equal(seed.stats.failures, 1);
    assert.equal(seed.stats.successes, 0);
    assert.equal(seed.degraded, false);

    const failedOutcome = { ...failingOutcome, status: 'failed', kbPlaybookStatus: 'failed' };
    await learn.run(ctx, { outcomes: [failedOutcome], verify: null, probe: baselineProbe(), confirm: true, kbDir: dir });
    seed = kb.loadCaseById(dir, 'camera-chin-startup-order');
    assert.equal(seed.stats.attempts, 2);
    assert.equal(seed.stats.failures, 2);
    assert.equal(seed.degraded, true);
    assert.equal(fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').trim().split('\n').length, 2);

    // degraded 的经验不再被选中，计划回退到自行尝试
    const planned = await planFor(dir);
    const cameraPlan = planned.plans.find((plan) => plan.unitId === 'camera.chin');
    assert.equal(cameraPlan.source, 'generated');
    assert.equal(cameraPlan.status, 'ready');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('仅历史日志进程退出：相机单元降级为人工观察，不自动重启', async () => {
  const dir = tempDir('roban-kb-historical');
  try {
    const nodes = selfcheck.EXPECTED_NODES.slice();
    const probe = baselineProbe({
      nodes,
      nodeCount: nodes.length,
      chinCameraNode: 'OK',
      rates: { ...baselineProbe().rates, chinCamera: 13.3 }
    });
    const detected = detect(probe);
    const units = faultUnits.build(detected);
    const camera = units.find((unit) => unit.id === 'camera.chin');
    assert.ok(camera, 'dead_processes 仍会归到 camera.chin 单元');
    assert.equal(camera.autoRepairable, false);
    assert.match(camera.manualReason, /历史日志/);

    const planned = await planFor(dir, probe);
    const cameraPlan = planned.plans.find((plan) => plan.unitId === 'camera.chin');
    assert.equal(cameraPlan.status, 'manual');
    assert.notEqual(cameraPlan.source, 'generated');

    const executed = await repairParallel.executePlans(silentCtx, [cameraPlan], {
      confirm: true,
      executeAction: fakeActionSequence(['success'])
    });
    assert.equal(executed.outcomes[0].status, 'manual_required');
    assert.equal(executed.outcomes[0].attempts.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('冷却期内复发：阻止自动重启并给出人工建议', async () => {
  const dir = tempDir('roban-kb-cooldown');
  try {
    seedKb(dir);
    const caseFile = path.join(dir, 'cases', 'camera-chin-startup-order.json');
    const seed = JSON.parse(fs.readFileSync(caseFile, 'utf8'));
    seed.stats = {
      attempts: 1,
      successes: 1,
      failures: 0,
      lastOutcome: 'success',
      lastAttemptAt: new Date(Date.now() - 120000).toISOString()
    };
    seed.cooldownMs = 900000;
    fs.writeFileSync(caseFile, JSON.stringify(seed, null, 2), 'utf8');

    const planned = await planFor(dir);
    const camera = planned.plans.find((plan) => plan.unitId === 'camera.chin');
    assert.equal(camera.status, 'blocked');
    assert.equal(camera.source, 'kb');
    assert.ok(camera.recurrence && camera.recurrence.detected);
    assert.match(camera.reason, /复发/);
    assert.equal(planned.recurrences.length, 1);

    const executed = await repairParallel.executePlans(silentCtx, planned.plans, {
      confirm: true,
      executeAction: fakeActionSequence(['success'])
    });
    const outcome = executed.outcomes.find((item) => item.unitId === 'camera.chin');
    assert.equal(outcome.status, 'blocked');
    assert.equal(executed.summary.success, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('learn：confirm=true 时记录复发事件并更新案例，dry-run 不写', async () => {
  const dir = tempDir('roban-kb-recurrence');
  try {
    seedKb(dir);
    const recurrence = {
      unitId: 'camera.chin',
      component: 'camera.chin',
      caseId: 'camera-chin-startup-order',
      elapsedMs: 143000,
      note: '重启后约 2.4 分钟复发'
    };

    const dry = await learn.run({ log() {} }, {
      outcomes: [],
      recurrences: [recurrence],
      probe: baselineProbe(),
      confirm: false,
      kbDir: dir
    });
    assert.equal(dry.kbWrite.skipped, true);
    assert.equal(fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').trim(), '');

    const write = await learn.run({ log() {} }, {
      outcomes: [],
      recurrences: [recurrence],
      probe: baselineProbe(),
      confirm: true,
      kbDir: dir
    });
    assert.equal(write.kbWrite.eventsWritten, 1);
    assert.ok(write.kbWrite.casesUpdated.includes('camera-chin-startup-order'));

    const events = fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').trim().split('\n');
    assert.equal(events.length, 1);
    const event = JSON.parse(events[0]);
    assert.equal(event.kind, 'recurrence');
    assert.equal(event.caseId, 'camera-chin-startup-order');
    assert.equal(event.elapsedMs, 143000);

    const seed = kb.loadCaseById(dir, 'camera-chin-startup-order');
    assert.equal(seed.recurrences, 1);
    assert.equal(seed.stats.attempts, 0);
    assert.equal(seed.stats.failures, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ *
 * 6) 安全边界
 * ------------------------------------------------------------------ */

test('白名单校验：知识库剧本含未授权动作时不可用', async () => {
  const dir = tempDir('roban-kb-unsafe');
  try {
    seedKb(dir);
    const caseFile = path.join(dir, 'cases', 'camera-chin-startup-order.json');
    const seed = JSON.parse(fs.readFileSync(caseFile, 'utf8'));
    seed.playbook = [{ action: 'StateJump' }];
    fs.writeFileSync(caseFile, JSON.stringify(seed, null, 2), 'utf8');

    const validation = kb.validateCase(seed);
    assert.equal(validation.ok, false);
    assert.match(validation.errors.join(' '), /未授权动作/);

    const planned = await planFor(dir);
    const cameraPlan = planned.plans.find((plan) => plan.unitId === 'camera.chin');
    assert.equal(cameraPlan.source, 'generated');
    assert.equal(cameraPlan.playbook[0].action, 'restart-chin-camera');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('dsh 旧流程兼容 & 复检目标合并', () => {
  const { TASKS, STEPS, STEPS_AUTO, stepsForTask, verifyTargetsFromState } = require('./workflow.js');
  assert.ok(TASKS['roban-selfcheck']);
  assert.ok(TASKS['roban-auto-repair']);
  assert.deepEqual(stepsForTask(TASKS['roban-selfcheck']).map((step) => step.id), STEPS.map((step) => step.id));
  assert.deepEqual(stepsForTask(TASKS['roban-auto-repair']).map((step) => step.id), STEPS_AUTO.map((step) => step.id));

  const state = {
    repairParallel: {
      outcomes: [
        { status: 'success', targets: ['a', 'b'] },
        { status: 'failed', targets: ['c'] },
        { status: 'manual_required', targets: ['d'] }
      ]
    }
  };
  assert.deepEqual(verifyTargetsFromState(state), ['a', 'b', 'c']);
});

/* ------------------------------------------------------------------ *
 * 8) 官方基线对照（knowledge/ 官方手册驱动的新增检测项）
 * ------------------------------------------------------------------ */

test('机型与版本识别：16.04 → Roban 1.0，20.04 → Roban 2.0', () => {
  const envProbe = require('../skills/env-probe.js');
  const p1 = envProbe.buildProbe({ OS_RELEASE: 'Ubuntu 16.04.7 LTS', REPO_COMMIT_DATE: '2022-05-01' });
  assert.equal(p1.robotModel, 'Roban 1.0');
  assert.equal(p1.repo.commitDate, '2022-05-01');
  assert.equal(p1.repo.outdated, true);

  const p2 = envProbe.buildProbe({ OS_RELEASE: 'Ubuntu 20.04.6 LTS', REPO_COMMIT_DATE: '2024-06-12' });
  assert.equal(p2.robotModel, 'Roban 2.0');
  assert.equal(p2.repo.outdated, false);

  const model = detect(baselineProbe({ osRelease: 'Ubuntu 16.04.7 LTS', robotModel: 'Roban 1.0' }))
    .checks.find((c) => c.id === 'robot_model');
  assert.equal(model.status, 'ok');
  assert.match(model.detail, /Roban 1\.0/);
});

test('代码新鲜度：早于 2023-11-29 判 warn，之后为 ok，仓库缺失为 warn', () => {
  const outdated = detect(baselineProbe({
    repo: { dir: 'OK', commitDate: '2022-05-01', commit: 'aaa', outdated: true }
  })).checks.find((c) => c.id === 'code_freshness');
  assert.equal(outdated.status, 'warn');
  assert.match(outdated.detail, /2023-11-29/);

  const fresh = detect(baselineProbe({
    repo: { dir: 'OK', commitDate: '2024-06-12', commit: 'bbb', outdated: false }
  })).checks.find((c) => c.id === 'code_freshness');
  assert.equal(fresh.status, 'ok');

  const missing = detect(baselineProbe({
    repo: { dir: 'MISSING', commitDate: null, commit: '', outdated: null }
  })).checks.find((c) => c.id === 'code_freshness');
  assert.equal(missing.status, 'warn');
});

test('自动登录：缺 autologin-user 或 timeout 都判 warn，齐备为 ok', () => {
  const noUser = detect(baselineProbe({
    boot: { lightdm: 'OK', autologinUser: '', autologinTimeout: '', startScript: 'OK', roscoreProcs: 2 }
  })).checks.find((c) => c.id === 'boot_autologin');
  assert.equal(noUser.status, 'warn');
  assert.match(noUser.detail, /lightdm/);

  const noTimeout = detect(baselineProbe({
    boot: { lightdm: 'OK', autologinUser: 'lemon', autologinTimeout: '', startScript: 'OK', roscoreProcs: 2 }
  })).checks.find((c) => c.id === 'boot_autologin');
  assert.equal(noTimeout.status, 'warn');
  assert.match(noTimeout.detail, /autologin-user-timeout/);

  const good = detect().checks.find((c) => c.id === 'boot_autologin');
  assert.equal(good.status, 'ok');
});

test('开机自启：start.sh 缺失 warn；有脚本但无 roscore 进程且 master 不可达 fail', () => {
  const noScript = detect(baselineProbe({
    boot: { lightdm: 'OK', autologinUser: 'lemon', autologinTimeout: '0', startScript: 'MISSING', roscoreProcs: 0 }
  })).checks.find((c) => c.id === 'boot_autostart');
  assert.equal(noScript.status, 'warn');

  const dead = detect(baselineProbe({
    rosMaster: 'FAIL',
    nodes: [],
    boot: { lightdm: 'OK', autologinUser: 'lemon', autologinTimeout: '0', startScript: 'OK', roscoreProcs: 0 }
  })).checks.find((c) => c.id === 'boot_autostart');
  assert.equal(dead.status, 'fail');
  assert.match(dead.detail, /start\.sh/);
});

test('零点备份：文件缺失时 warn（官方要求镜像刷新前先备份零点）', () => {
  const c = detect(baselineProbe({
    zeroPoint: { officialOffset: 'MISSING', officialOffsetLines: 0, stairOffset: 'MISSING' }
  })).checks.find((item) => item.id === 'zero_point_backup');
  assert.equal(c.status, 'warn');
  assert.match(c.detail, /offset\.yaml/);
});

test('开机宽限期：开机 60 s 时缺节点只判 warn，不判 fail', () => {
  const justBooted = selfcheck.evaluate(baselineProbe({ uptimeSeconds: 60 })).checks
    .find((c) => c.id === 'expected_nodes');
  assert.equal(justBooted.status, 'warn');
  assert.match(justBooted.detail, /开机不足|40 s/);

  const settled = selfcheck.evaluate(baselineProbe({ uptimeSeconds: 3600 })).checks
    .find((c) => c.id === 'expected_nodes');
  assert.equal(settled.status, 'fail');
});

test('官方基线告警归入人工单元：system.version / system.boot 不允许自动修复', () => {
  const detected = detect(baselineProbe({
    repo: { dir: 'OK', commitDate: '2022-05-01', commit: 'aaa', outdated: true },
    boot: { lightdm: 'OK', autologinUser: '', autologinTimeout: '', startScript: 'OK', roscoreProcs: 2 }
  }));
  const units = faultUnits.build(detected);
  const versionUnit = units.find((u) => u.id === 'system.version');
  const bootUnit = units.find((u) => u.id === 'system.boot');
  assert.ok(versionUnit, '应存在 system.version 单元');
  assert.ok(bootUnit, '应存在 system.boot 单元');
  assert.equal(versionUnit.autoRepairable, false);
  assert.equal(bootUnit.autoRepairable, false);
  assert.match(`${versionUnit.manualReason}${bootUnit.manualReason}`, /人工|手动/);
  // 唯一允许自动修复的仍是下巴相机（白名单动作）
  assert.deepEqual(units.filter((u) => u.autoRepairable).map((u) => u.id), ['camera.chin']);
});

test('官方基线技能：每条对照都带官方出处，且不自动执行官方 check 程序', async () => {
  const officialBaseline = require('../skills/official-baseline.js');
  const probe = baselineProbe({
    topics: { count: 1, all: ['/chin_camera/image'], footPressure: [], sensorHub: [] }
  });
  const out = await officialBaseline.run({ log() {} }, { probe, checks: detect(probe).checks });
  assert.ok(out.baseline.mismatches.length > 0);
  for (const item of out.baseline.mismatches) {
    assert.ok(item.citation && item.citation.length > 0, `${item.item} 缺少官方出处`);
  }
  assert.ok(out.baseline.mismatches.some((m) => m.item === '官方事件式数据流'));
  const checkStep = out.baseline.officialSelfCheck.find((s) => s.step === '官方自检程序');
  assert.equal(checkStep.agentRunsIt, false, '官方 check 程序必须人工运行');
  assert.ok(out.baseline.safetyNotes.length >= 1);
});

test('报告包含「官方对照」段落并写出官方出处', async () => {
  const officialBaseline = require('../skills/official-baseline.js');
  const report = require('../skills/report.js');
  const probe = baselineProbe({ repo: { dir: 'OK', commitDate: '2022-05-01', commit: 'aaa', outdated: true } });
  const evaluated = selfcheck.evaluate(probe);
  const out = await officialBaseline.run({ log() {} }, { probe, checks: evaluated.checks });
  const md = report.buildMarkdown({
    probe,
    checks: evaluated.checks,
    summary: evaluated.summary,
    diagnosis: { findings: [], hypotheses: [], repairCandidates: [], needsUserInput: [] },
    repair: null,
    verify: null,
    safety: null,
    baseline: out.baseline
  });
  assert.match(md, /## 官方对照/);
  assert.match(md, /《Roban机器人版本查询手册》/);
  assert.match(md, /人工/);
});
