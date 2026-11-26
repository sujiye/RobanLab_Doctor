'use strict';
/**
 * 零位标定 CLI（人工在环）。
 *
 * 用法：
 *   ROBAN_HOST=<ROBOT_IP> node workflow/calibrate-adapter.js calibrate \
 *     --joint 7 --layer pose --expected-angle 0 --actual-angle 3.2 --sign 1
 *
 *   # 手机测量页提交后，用 capture JSON：
 *   ROBAN_HOST=<ROBOT_IP> node workflow/calibrate-adapter.js calibrate \
 *     --joint 7 --expected-angle 0 --capture capture-2026-....json --sign 1
 *
 *   # 用户手动运行 apply 脚本并重启 BodyHub 后复检：
 *   ROBAN_HOST=<ROBOT_IP> node workflow/calibrate-adapter.js calibrate-verify \
 *     --joint 7 --expected-offset 8.2
 *
 * 本工具不会写机器人 offset、不会重启 BodyHub、不会移动/卸力关节。
 */

const path = require('path');
const { makeCtx } = require('./harness-adapter.example.js');
const { TASKS, runTask } = require('./calibration-workflow.js');
const skills = require('../skills');

function argValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function numberArg(argv, name, fallback = undefined) {
  const raw = argValue(argv, name);
  if (raw == null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function usage() {
  console.log([
    '用法:',
    '  ROBAN_HOST=<ROBOT_IP> node workflow/calibrate-adapter.js calibrate \\',
    '    --joint <1-22> [--layer pose|pack] --expected-angle <deg> \\',
    '    (--actual-angle <deg> | --capture <capture.json>) [--sign 1|-1] [--note "..."]',
    '',
    '  ROBAN_HOST=<ROBOT_IP> node workflow/calibrate-adapter.js calibrate-verify \\',
    '    --joint <1-22> [--layer pose|pack] --expected-offset <deg>',
    '',
    '说明：',
    '  - IP 必须来自用户当前消息；不得从知识库/历史会话/报告读取。',
    '  - 只生成候选 offset、备份、patch 和 apply 脚本；不写机器人。',
    '  - apply 脚本与 BodyHub 重启必须由用户手动完成。',
    '  - 手机测量页：node tools/phone-camera/server.js'
  ].join('\n'));
}

function printCalibrationState(state) {
  const out = {
    plan: state.calibrationPlan || null,
    measurement: state.calibrationMeasurement || null,
    offset: state.calibrationOffset || null,
    verify: state.calibrationVerify || null,
    reportPath: state.calibrationReport && state.calibrationReport.path
      ? state.calibrationReport.path
      : null
  };
  console.log(JSON.stringify(out, null, 2));
}

async function main() {
  const argv = process.argv.slice(2);
  const mode = argv.find((arg) => !arg.startsWith('--')) || 'calibrate';
  const ctx = makeCtx({ quiet: false });
  if (!ctx.remote.host) {
    console.error('[fatal] 缺少 ROBAN_HOST。请询问用户当前机器人 IP；不得从知识库/历史会话/报告读取。');
    usage();
    process.exit(2);
  }
  ctx.calibrationDir = path.join(__dirname, '..', 'calibration');

  const jointId = numberArg(argv, '--joint', Number(process.env.ROBAN_JOINT_ID));
  const layer = argValue(argv, '--layer') || 'pose';
  const expectedAngle = numberArg(argv, '--expected-angle', Number(process.env.ROBAN_EXPECTED_ANGLE));
  const actualAngle = numberArg(argv, '--actual-angle', Number(process.env.ROBAN_ACTUAL_ANGLE));
  const captureFile = argValue(argv, '--capture');
  const sign = numberArg(argv, '--sign', 1);
  const note = argValue(argv, '--note') || '';

  if (!Number.isFinite(jointId)) {
    usage();
    process.exit(2);
  }

  if (mode === 'calibrate') {
    const result = await runTask(ctx, TASKS['roban-zero-calibration'], {
      until: 'report',
      state: {
        jointId,
        layer,
        expectedAngle,
        actualAngle,
        captureFile,
        sign,
        note,
        calibrationDir: ctx.calibrationDir
      }
    });
    if (result.state.calibrationReport && result.state.calibrationReport.markdown) {
      console.log('\n' + result.state.calibrationReport.markdown);
    } else {
      printCalibrationState(result.state);
    }
    return;
  }

  if (mode === 'calibrate-verify') {
    const expectedOffset = numberArg(argv, '--expected-offset');
    const out = await skills.get('calibration-verify').run(ctx, {
      jointId,
      layer,
      expectedOffset
    });
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  usage();
  process.exit(2);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[fatal]', err.message);
    process.exit(1);
  });
}
