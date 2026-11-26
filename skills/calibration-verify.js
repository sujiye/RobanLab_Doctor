'use strict';
/**
 * calibration-verify —— 用户手动 apply 后，只读比对 offset 文件，并提示人工视觉确认。
 */

const sshRun = require('./ssh-run.js');
const { LAYER_PATH } = require('./calibration-plan.js');
const { parseOffset } = require('./calibration-offset.js');

const id = 'calibration-verify';
const title = '零位 offset 复检';
const description = '读取修改后的 offset 并与候选值比对；同时要求人工视觉确认';
const inputs = {
  jointId: 'number',
  layer: 'pose 或 pack',
  expectedOffset: 'number|null，apply 脚本里的候选值',
  tolerance: 'number，默认 0.01 度'
};

async function run(ctx, {
  jointId,
  layer = 'pose',
  expectedOffset,
  tolerance = 0.01
} = {}) {
  const idNum = Number(jointId);
  if (!Number.isInteger(idNum) || idNum < 1 || idNum > 22) {
    throw new Error('jointId 必须是 1–22 的整数');
  }
  if (!LAYER_PATH[layer]) throw new Error('layer 只能是 pose 或 pack');

  const remotePath = LAYER_PATH[layer];
  const read = await sshRun.run(ctx, { command: `cat ${remotePath}` });
  if (read.code !== 0) {
    throw new Error(`读取 ${remotePath} 失败：${read.stderr.slice(-1000)}`);
  }
  const current = parseOffset(read.stdout, idNum);
  const expected = expectedOffset == null ? null : Number(expectedOffset);
  const matches = expected === null ? null : Math.abs(current - expected) <= Number(tolerance);

  const result = {
    jointId: idNum,
    layer,
    remotePath,
    currentOffset: current,
    expectedOffset: expected,
    tolerance: Number(tolerance),
    matches,
    requiresVisualConfirmation: true,
    humanChecklist: [
      '确认机器人已由人工手动重启 BodyHub（不要由 agent 重启）。',
      '把关节移动到同一参考姿态，用角度尺/手机页面复测实际角度。',
      '确认残余偏差是否在可接受范围内；若仍偏差明显，检查舵机臂齿位/连杆，而不是继续加大 offset。'
    ]
  };

  ctx.log(
    `[calibration-verify] ID${idNum} ${layer}: current=${current} ` +
    `expected=${expected === null ? '-' : expected} matches=${matches}`
  );
  return { state: { calibrationVerify: result }, ...result };
}

module.exports = { id, title, description, inputs, run };
