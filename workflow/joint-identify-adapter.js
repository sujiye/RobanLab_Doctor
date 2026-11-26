'use strict';
/**
 * 手动转动识别关节 ID + 读取零点。
 *
 * 三阶段（每阶段都需要用户批准一次控制读）：
 *   baseline：读取 22 个关节，保存基线
 *   用户手动大幅转动一个关节
 *   diff：再次读取，按变化量识别关节 ID
 *   用户把该关节手动放到正确零点
 *   zero：再次读取，得到 zeroAngle（候选修正量 = -zeroAngle）
 *
 * 用法：
 *   ROBAN_HOST=<ROBOT_IP> node workflow/joint-identify-adapter.js baseline --control-approved
 *   # 用户手动转动一个关节
 *   ROBAN_HOST=<ROBOT_IP> node workflow/joint-identify-adapter.js diff --control-approved
 *   # 用户把识别到的关节放到正确零点
 *   ROBAN_HOST=<ROBOT_IP> node workflow/joint-identify-adapter.js zero --joint 7 --control-approved
 *
 * 控制读只做 StateJump setStatus -> reset，触发 ReadJointValue 刷新缓存；
 * 不运动、不改扭矩、不写 offset。失败会尝试 reset 并报告状态。
 */

const path = require('path');
const { makeCtx } = require('./harness-adapter.example.js');
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
    '  ROBAN_HOST=<ROBOT_IP> node workflow/joint-identify-adapter.js baseline --control-approved',
    '  ROBAN_HOST=<ROBOT_IP> node workflow/joint-identify-adapter.js diff --control-approved',
    '  ROBAN_HOST=<ROBOT_IP> node workflow/joint-identify-adapter.js zero --joint <ID> [--expected-zero 0] --control-approved',
    '',
    '控制读会短暂占用 BodyHub 状态机并立即 reset；必须由用户逐次批准。',
    '不运动、不改扭矩、不写 offset。机器人必须支撑好、处于 preReady、masterID=0。'
  ].join('\n'));
}

async function main() {
  const argv = process.argv.slice(2);
  const phase = argv.find((arg) => !arg.startsWith('--')) || 'baseline';
  const controlApproved = argv.includes('--control-approved') ||
    process.env.ROBAN_CONTROL_APPROVED === '1';
  const ctx = makeCtx({ quiet: false });
  if (!ctx.remote.host) {
    console.error('[fatal] 缺少 ROBAN_HOST。请询问用户当前机器人 IP；不得从知识库/历史会话/报告读取。');
    usage();
    process.exit(2);
  }
  ctx.calibrationDir = path.join(__dirname, '..', 'calibration');
  ctx.controlApproved = controlApproved;

  const jointId = numberArg(argv, '--joint');
  const expectedZero = numberArg(argv, '--expected-zero', 0);

  if (!['baseline', 'diff', 'zero'].includes(phase)) {
    usage();
    process.exit(2);
  }

  if (!controlApproved) {
    console.error('[blocked] 控制读需要用户逐次批准：加 --control-approved（或设置 ROBAN_CONTROL_APPROVED=1）。');
    process.exit(3);
  }

  const skill = skills.get('joint-identify');
  const out = await skill.run(ctx, {
    phase,
    controlApproved,
    jointId,
    expectedZero,
    stateDir: path.join(ctx.calibrationDir, 'state')
  });

  console.log(JSON.stringify(out, null, 2));

  if (out.status === 'baseline_saved') {
    console.log('\n下一步：手动大幅转动一个关节（其他关节保持不动），然后运行 diff。');
  } else if (out.status === 'identified') {
    console.log(`\n识别到 ID${out.jointId}。确认无误后，把该关节手动放到正确零点，再运行：`);
    console.log(`  ROBAN_HOST=${ctx.remote.host} node workflow/joint-identify-adapter.js zero --joint ${out.jointId} --control-approved`);
  } else if (out.status === 'ambiguous' || out.status === 'no_clear_motion') {
    console.log('\n未唯一识别。请只转动一个关节，必要时重新做 baseline。');
  } else if (out.status === 'zero_captured') {
    console.log('\n下一步：用这次读数生成候选 offset（不会写机器人）：');
    console.log(
      `  ROBAN_HOST=${ctx.remote.host} node workflow/calibrate-adapter.js calibrate ` +
      `--joint ${out.jointId} --layer pose --expected-angle 0 ` +
      `--actual-angle ${out.zeroAngle} --sign -1 --note "手动转动识别 ID${out.jointId} 后零点标定"`
    );
  } else if (out.status === 'blocked') {
    console.log('\n控制读被安全审查阻止：' + (out.reason || '缺少用户批准'));
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[fatal]', err.message);
    process.exit(1);
  });
}
