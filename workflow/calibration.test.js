'use strict';
/**
 * 零位标定 workflow 的单元测试（不连机器人）。
 * 运行：node --test workflow/calibration.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const calibrationPlan = require('../skills/calibration-plan.js');
const calibrationMeasure = require('../skills/calibration-measure.js');
const calibrationOffset = require('../skills/calibration-offset.js');
const jointIdentify = require('../skills/joint-identify.js');
const jointPositions = require('../skills/joint-positions.js');
const safety = require('../skills/safety.js');

const silentCtx = { log() {}, fs };

test('标定规划：正常偏差计算 delta 并给出人工步骤', async () => {
  const out = await calibrationPlan.run(silentCtx, {
    jointId: 7,
    layer: 'pose',
    expectedAngle: 0,
    actualAngle: 3.2,
    sign: 1
  });
  assert.equal(out.plan.status, 'ready');
  assert.equal(out.plan.delta, 3.2);
  assert.ok(out.plan.humanSteps.some((step) => step.includes('支撑')));
  assert.equal(out.plan.applyPolicy.automatic, false);
});

test('标定规划：偏差超过 45° 时阻止只靠软件补偿', async () => {
  const out = await calibrationPlan.run(silentCtx, {
    jointId: 7,
    expectedAngle: 0,
    actualAngle: 60,
    sign: 1
  });
  assert.equal(out.plan.status, 'blocked');
  assert.ok(out.plan.warnings.some((warning) => warning.includes('45')));
});

test('标定测量：人工角度转 delta', async () => {
  const out = await calibrationMeasure.run(silentCtx, {
    jointId: 7,
    expectedAngle: 0,
    actualAngle: 3.2
  });
  assert.equal(out.measurement.source, 'manual');
  assert.equal(out.measurement.delta, 3.2);
});

test('标定测量：读取手机 capture JSON', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roban-cal-'));
  try {
    const file = path.join(dir, 'capture-test.json');
    fs.writeFileSync(file, JSON.stringify({
      createdAt: '2026-11-19T03:00:00Z',
      angleDeg: -2.4,
      note: 'phone test'
    }));
    const out = await calibrationMeasure.run(silentCtx, {
      jointId: 7,
      expectedAngle: 0,
      captureFile: file,
      capturesDir: dir
    });
    assert.equal(out.measurement.source, 'phone');
    assert.equal(out.measurement.delta, -2.4);
    assert.equal(out.measurement.captureFile, file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('offset 解析：只取目标 ID 的当前值', () => {
  const text = [
    'offset:',
    '  ID1: -25',
    '  ID7: 5',
    '  ID22: 120'
  ].join('\n');
  assert.equal(calibrationOffset.parseOffset(text, 7), 5);
  assert.equal(calibrationOffset.parseOffset(text, 1), -25);
  assert.equal(calibrationOffset.parseOffset(text, 99), null);
});

test('标定动作在 safety 白名单内，且不包含运动/写 offset', () => {
  const review = safety.reviewActions([
    'read-offsets',
    'prepare-offset-patch',
    'verify-offset',
    'capture-calibration-photo'
  ], { execute: true });
  assert.equal(review.approved, true);
  assert.equal(review.motionActions.length, 0);
});

test('手动转动识别：变化最大的关节被识别为 ID，且能区分歧义', () => {
  const before = new Array(22).fill(0);
  const after = new Array(22).fill(0);
  after[6] = 20; // ID7
  const candidates = jointIdentify.computeCandidates(before, after);
  assert.equal(candidates[0].jointId, 7);
  assert.equal(candidates[0].delta, 20);

  const ambiguous = after.slice();
  ambiguous[5] = 18; // ID6 也大幅变化
  const second = jointIdentify.computeCandidates(before, ambiguous);
  assert.equal(second[0].jointId, 7);
  assert.equal(second[1].jointId, 6);
  assert.ok(second[1].absDelta > second[0].absDelta * jointIdentify.AMBIGUITY_RATIO);
});

test('控制读必须逐次批准；dry-run 只给警告', () => {
  const blocked = safety.reviewActions(['refresh-joint-positions'], { execute: true });
  assert.equal(blocked.approved, false);
  assert.ok(blocked.violations.some((item) => item.type === 'control_unapproved'));

  const approved = safety.reviewActions(['refresh-joint-positions'], {
    execute: true,
    controlApproved: true
  });
  assert.equal(approved.approved, true);
  assert.deepEqual(approved.controlActions, ['refresh-joint-positions']);

  const dry = safety.reviewActions(['refresh-joint-positions'], { execute: false });
  assert.equal(dry.approved, true);
  assert.ok(dry.warnings.some((item) => item.type === 'control_plan_only'));
});

test('控制读未批准时 joint-positions 直接 blocked，不发起 SSH', async () => {
  const out = await jointPositions.refreshAndRead({ log() {} }, { controlApproved: false });
  assert.equal(out.status, 'blocked');
  assert.ok(out.reason.includes('批准'));
});
