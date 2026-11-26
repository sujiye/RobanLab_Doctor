'use strict';
/**
 * 泛用视觉诊断的单测（不连机器人）。
 * 运行：node --test workflow/general-diagnosis.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const symptomIntake = require('../skills/symptom-intake.js');
const visualEvidence = require('../skills/visual-evidence.js');
const generalHypothesis = require('../skills/general-hypothesis.js');
const generalReport = require('../skills/general-report.js');

const ctx = { log() {}, fs };

function probe(overrides = {}) {
  return Object.assign({
    usbCam: 'OK',
    chinCameraNode: 'UNREACHABLE',
    bodyhubState: 'preReady',
    masterId: 0,
    tempZeroIds: [],
    battery: { voltage: 12.2 },
    logs: { dxlBulkReadErrors: 0, deadProcesses: 0 }
  }, overrides);
}

function symptom(tags, extra = {}) {
  return {
    description: extra.description || '',
    tags,
    redFlags: false,
    questions: [],
    ...extra
  };
}

test('症状分类：手臂/运动/零位/相机/红旗', () => {
  const arm = symptomIntake.classify('右臂抬不起来，关节角度不对');
  assert.ok(arm.tags.includes('arm'));
  assert.ok(arm.tags.includes('motion'));
  assert.ok(arm.tags.includes('zero'));

  const camera = symptomIntake.classify('相机黑屏，没有画面');
  assert.ok(camera.tags.includes('camera'));

  const red = symptomIntake.classify('关节冒烟而且有焦味');
  assert.equal(red.redFlags, true);
});

test('视觉证据：图片存在 + capture JSON 被读取', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roban-vision-'));
  try {
    const image = path.join(dir, 'arm.jpg');
    fs.writeFileSync(image, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const capture = path.join(dir, 'capture.json');
    fs.writeFileSync(capture, JSON.stringify({
      imageFile: image,
      angleDeg: 3.2,
      note: '右臂照片',
      createdAt: '2026-11-19T03:00:00Z'
    }));

    const out = await visualEvidence.run(ctx, {
      images: [image],
      captures: [capture],
      visionObservations: { visibleFacts: ['右肘下垂'] }
    });
    assert.equal(out.visualEvidence.ready, true);
    assert.equal(out.visualEvidence.images.length, 2); // 图片 + capture 里的 imageFile
    assert.equal(out.visualEvidence.captures.length, 1);
    assert.equal(out.visualEvidence.hasObservations, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('相机黑屏 + 设备存在/节点失联 → 给出 restart-chin-camera 候选', () => {
  const checks = [
    { id: 'camera_chin', status: 'fail', detail: '无数据且节点不可访问' },
    { id: 'servo_bus_errors', status: 'ok', detail: '无错误' }
  ];
  const result = generalHypothesis.build({
    description: '相机黑屏',
    symptom: symptom(['camera'], { description: '相机黑屏' }),
    visualEvidence: { ready: true, visionObservations: { visibleFacts: ['画面全黑'] } },
    probe: probe(),
    checks
  });
  const actions = result.safeActions.map((item) => item.action);
  assert.ok(actions.includes('restart-chin-camera'));
});

test('手臂下垂 + 总线告警 → 人工检查，不自动执行运动', () => {
  const checks = [
    { id: 'servo_bus_errors', status: 'warn', detail: 'dxlBulkRead 错误' },
    { id: 'servo_scan', status: 'ok', detail: '1-22 在线' }
  ];
  const result = generalHypothesis.build({
    description: '右臂下垂，抬不起来',
    symptom: symptom(['arm', 'motion'], { description: '右臂下垂，抬不起来' }),
    visualEvidence: { ready: true, visionObservations: { visibleFacts: ['右肘明显低于左肘'] } },
    probe: probe(),
    checks
  });
  const arm = result.hypotheses.find((item) => item.id === 'general-arm-mechanical');
  assert.ok(arm);
  assert.equal(arm.safeActions.length, 0);
  assert.ok(arm.manualActions.some((item) => item.includes('支撑')));
});

test('零位描述 → 推荐零位标定 workflow', () => {
  const result = generalHypothesis.build({
    description: '右臂零位偏移，角度不准',
    symptom: symptom(['arm', 'zero'], { description: '右臂零位偏移，角度不准' }),
    visualEvidence: { ready: false, missing: ['没有图片'] },
    probe: null,
    checks: null
  });
  assert.equal(result.recommendedWorkflow, 'roban-zero-calibration');
});

test('报告包含描述、视觉事实和候选原因', () => {
  const generalDiagnosis = generalHypothesis.build({
    description: '相机黑屏',
    symptom: symptom(['camera'], { description: '相机黑屏' }),
    visualEvidence: { ready: true, visionObservations: { visibleFacts: ['画面全黑'] }, images: [] },
    probe: probe(),
    checks: [{ id: 'camera_chin', status: 'fail', detail: '无数据' }]
  });
  const markdown = generalReport.buildMarkdown({
    symptom: symptom(['camera'], { description: '相机黑屏' }),
    visualEvidence: { ready: true, images: [], visionObservations: { visibleFacts: ['画面全黑'] } },
    checks: [],
    summary: null,
    generalDiagnosis,
    repair: null
  });
  assert.match(markdown, /相机黑屏/);
  assert.match(markdown, /画面全黑/);
  assert.match(markdown, /候选原因/);
});
