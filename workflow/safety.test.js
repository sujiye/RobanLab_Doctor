'use strict';
/**
 * safety / ATTENTION 规则的单元测试。
 * 运行：node --test workflow/safety.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const safety = require('../skills/safety.js');
const kb = require('../skills/kb.js');

test('每次审查都会读取 ATTENTION 并带 SHA-256', () => {
  const review = safety.reviewActions(['restart-chin-camera']);
  assert.equal(review.approved, true);
  assert.match(review.rules.sha256, /^[a-f0-9]{64}$/);
  assert.ok(review.rules.loadedAt);
  assert.equal(review.motionActions.length, 0);
});

test('运动动作缺少批准或停止方式时被阻止', () => {
  const review = safety.reviewActions(['move-joint']);
  assert.equal(review.approved, false);
  assert.ok(review.violations.some((item) => item.type === 'motion_unapproved'));
  assert.ok(review.violations.some((item) => item.type === 'stop_missing'));
  assert.ok(review.stopInstructions.includes('急停'));
});

test('dry-run 只展示运动计划：给警告但不阻止', () => {
  const review = safety.reviewActions(['move-joint'], { execute: false });
  assert.equal(review.approved, true);
  assert.equal(review.violations.length, 0);
  assert.ok(review.warnings.some((item) => item.type === 'motion_plan_only'));
});

test('运动动作有逐次批准和停止方式才通过', () => {
  const review = safety.reviewActions(['move-joint'], {
    motionApproved: true,
    stopPlan: '按下硬件急停'
  });
  assert.equal(review.approved, true);
  assert.deepEqual(review.motionActions, ['move-joint']);
});

test('重启 / 关节断电 / StateJump 属于禁止动作', () => {
  for (const action of ['reboot', 'killall roslaunch', 'SetServoLockStateAll', 'StateJump']) {
    const item = safety.classifyAction(action);
    assert.equal(item.forbidden, true, action);
    assert.equal(item.allowed, false, action);
  }
});

test('IP 脱敏：字段和字符串都不保留地址', () => {
  const input = {
    ip: '198.51.100.7',
    host: 'robot.local',
    note: 'connect 198.51.100.7',
    nested: { address: '203.0.113.9' }
  };
  const out = safety.redactIps(input);
  assert.equal(out.ip, '[REDACTED_IP]');
  assert.equal(out.host, '[REDACTED_IP]');
  assert.equal(out.nested.address, '[REDACTED_IP]');
  assert.ok(!JSON.stringify(out).includes('198.51.100.7'));
});

test('知识库不得使用 IP/主机地址作为匹配谓词', () => {
  const byPath = kb.matchPredicates(
    [{ path: 'ip', op: 'eq', value: '198.51.100.7' }],
    { ip: '198.51.100.7' }
  );
  assert.equal(byPath.passed, false);
  assert.match(byPath.reasons.join(' '), /IP/);

  const byValue = kb.matchPredicates(
    [{ path: 'host', op: 'eq', value: '198.51.100.7' }],
    { host: '198.51.100.7' }
  );
  assert.equal(byValue.passed, false);
});
