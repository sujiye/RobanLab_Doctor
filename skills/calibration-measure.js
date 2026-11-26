'use strict';
/**
 * calibration-measure —— 读取人工/手机测量结果，计算与期望角度的偏差。
 * 不连接机器人、不修改任何文件。
 */

const fsDefault = require('fs');
const path = require('path');

const id = 'calibration-measure';
const title = '零位偏差测量（人工/手机）';
const description = '把实际角度与期望角度转成 delta；支持手机测量 JSON';
const inputs = {
  jointId: 'number',
  expectedAngle: 'number',
  actualAngle: 'number|null',
  captureFile: 'string|null，手机页面保存的 capture JSON',
  capturesDir: 'string，默认 ./calibration/captures'
};

function readCapture(ctx, captureFile, capturesDir) {
  const fs = ctx.fs || fsDefault;
  let file = captureFile;
  if (!file) return null;
  if (!path.isAbsolute(file)) {
    const direct = path.resolve(process.cwd(), file);
    const fallback = path.resolve(
      capturesDir || path.join(process.cwd(), 'calibration', 'captures'),
      file
    );
    file = fs.existsSync(direct) ? direct : fallback;
  }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { file, data };
}

async function run(ctx, {
  jointId,
  expectedAngle,
  actualAngle,
  captureFile,
  capturesDir
} = {}) {
  const expected = Number(expectedAngle);
  if (!Number.isFinite(expected)) throw new Error('expectedAngle 必须是数字');

  let actual = Number(actualAngle);
  let source = 'manual';
  let capture = null;

  if (!Number.isFinite(actual) && captureFile) {
    capture = readCapture(ctx, captureFile, capturesDir);
    if (!capture) throw new Error(`找不到测量文件：${captureFile}`);
    actual = Number(capture.data.angleDeg);
    source = 'phone';
  }

  if (!Number.isFinite(actual)) {
    return {
      state: {
        calibrationMeasurement: {
          jointId,
          expectedAngle: expected,
          actualAngle: null,
          delta: null,
          status: 'need_measurement'
        }
      },
      status: 'need_measurement',
      instructions: [
        '用角度尺/数字水平仪测量实际角度，或打开 tools/phone-camera 页面拍照测量。',
        '把实际角度（度）提供给 workflow；不要用 GetJointAngle 的缓存值代替物理测量。'
      ]
    };
  }

  const delta = Number((actual - expected).toFixed(4));
  const measurement = {
    jointId,
    expectedAngle: expected,
    actualAngle: actual,
    delta,
    source,
    captureFile: capture ? capture.file : null,
    capturedAt: capture ? capture.data.createdAt || null : null,
    note: capture ? capture.data.note || '' : '',
    status: 'ready'
  };

  ctx.log(
    `[calibration-measure] ID${jointId} expected=${expected} actual=${actual} ` +
    `delta=${delta} source=${source}`
  );
  return { state: { calibrationMeasurement: measurement }, measurement };
}

module.exports = { id, title, description, inputs, run };
