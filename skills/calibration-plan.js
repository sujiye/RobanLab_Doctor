'use strict';
/**
 * calibration-plan —— 零位标定的入口规划。
 *
 * 零位偏移不能只靠软件读出：本 skill 只做输入校验、风险分级和人工步骤编排，
 * 不写 offset、不重启 BodyHub、不移动关节。
 */

const id = 'calibration-plan';
const title = '零位标定规划（人工在环）';
const description = '校验关节/层/角度输入，给出人工支撑、测量、apply 和复检步骤';
const inputs = {
  jointId: 'number，1–22',
  layer: 'string，pose（~/.lejuconfig/offset.yaml）或 pack（bodyhub_new/config/offset.yaml）',
  expectedAngle: 'number，当前指令姿态下该关节应有的角度（度）',
  actualAngle: 'number|null，人工/手机测得的实际角度（度）',
  captureFile: 'string|null，手机测量 JSON 路径',
  sign: 'number，1 或 -1，offset 修正方向；需人工确认',
  note: 'string，现场观察/最近是否拆装过舵机臂'
};

const LAYER_PATH = {
  pose: '/home/lemon/.lejuconfig/offset.yaml',
  pack: '/home/lemon/robot_ros_application/catkin_ws/src/bodyhub_new/config/offset.yaml'
};

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function run(ctx, input = {}) {
  const jointId = Number(input.jointId);
  if (!Number.isInteger(jointId) || jointId < 1 || jointId > 22) {
    throw new Error('jointId 必须是 1–22 的整数');
  }

  const layer = input.layer || 'pose';
  if (!LAYER_PATH[layer]) {
    throw new Error('layer 只能是 pose 或 pack');
  }

  const expectedAngle = numberOrNull(input.expectedAngle);
  const actualAngle = numberOrNull(input.actualAngle);
  const sign = input.sign === -1 ? -1 : 1;
  const warnings = [];

  if (input.sign !== 1 && input.sign !== -1) {
    warnings.push('未明确 sign，默认按 +1 计算；apply 前必须用小角度测试确认方向。');
  }

  let status = 'ready';
  let delta = null;
  if (expectedAngle === null) {
    status = 'need_expected_angle';
  } else if (actualAngle === null && input.captureFile) {
    warnings.push('实际角度将从手机 capture JSON 读取；apply 前必须由用户确认测量结果。');
  } else if (actualAngle === null) {
    status = 'need_measurement';
  } else {
    delta = Number((actualAngle - expectedAngle).toFixed(4));
    const abs = Math.abs(delta);
    if (abs > 45) {
      status = 'blocked';
      warnings.push('偏差超过 45°，优先检查舵机臂是否装错齿、连杆是否松动或编码器/机械限位异常，不建议只靠软件 offset 补偿。');
    } else if (abs > 15) {
      warnings.push('偏差超过 15°，可能是机械安装问题；软件补偿只能作为临时措施。');
    }
    if (abs < 0.05) {
      warnings.push('偏差小于 0.05°，接近测量分辨率；确认测量工具精度后再决定是否修改。');
    }
  }

  const humanSteps = [
    '把机器人放在支撑/吊挂或有人扶住的稳定状态，确保手臂不会因卸力或误动作跌落。',
    '人工把目标关节移动到已知参考姿态（初始零位或工装/标记对齐位）。',
    '用角度尺/数字水平仪，或手机相机页面测量实际角度；测量结果必须由用户确认。',
    '确认 offset 修正方向（sign）：先做一次极小角度测试，观察实际运动方向是否与预期一致。',
    '运行本 workflow 生成候选 offset、备份和 apply 脚本。',
    '由用户在机器人上手动运行 apply 脚本；agent 不直接写 offset。',
    '用户手动重启 BodyHub（或在厂家允许的流程下重新加载 offset），然后复检。',
    '复检：重新读 offset、重新测量角度、确认残余偏差；必要时重复一次。'
  ];

  const plan = {
    jointId,
    layer,
    layerPath: LAYER_PATH[layer],
    expectedAngle,
    actualAngle,
    delta,
    sign,
    status,
    warnings,
    humanSteps,
    measurement: {
      manual: '用角度尺/数字水平仪测量连杆相对参考面的角度，读数精确到 0.5° 以内。',
      phone: '手机固定在支架上，画面同时包含基座参考线和连杆标记；用 tools/phone-camera 页面取两点连线计算角度。',
      caution: '手持手机、没有固定参考线时，单张照片不能给出绝对零位角度。'
    },
    applyPolicy: {
      automatic: false,
      requiresHumanApply: true,
      requiresBodyhubRestartByHuman: true
    }
  };

  ctx.log(`[calibration-plan] joint=ID${jointId} layer=${layer} status=${status} delta=${delta}`);
  for (const warning of warnings) ctx.log(`[calibration-plan][warn] ${warning}`);
  return { state: { calibrationPlan: plan }, plan };
}

module.exports = { id, title, description, inputs, run, LAYER_PATH };
