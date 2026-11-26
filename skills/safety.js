'use strict';
/**
 * safety —— ATTENTION 规则的代码审查层。
 *
 * 每次 review / assert 都会重新读取 ATTENTION/ATTENTION.md，保证规则文件是唯一来源。
 * 负责：
 *   1) 动作分类：只读 / 白名单非运动修复 / 运动（需批准 + 停止方式）/ 禁止；
 *   2) 知识库 IP 脱敏与检测；
 *   3) 运动指令的停止说明。
 */

const fsDefault = require('fs');
const path = require('path');
const crypto = require('crypto');

const ATTENTION_PATH = path.join(__dirname, '..', 'ATTENTION', 'ATTENTION.md');
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const IP_KEY_RE = /^(ip|host|hostname|address|remotehost|sshhost|robotip)$/i;

const SAFE_ACTIONS = {
  'restart-chin-camera': {
    motion: false,
    forbidden: false,
    level: 'L2',
    reason: '非运动节点重启；不触碰 BodyHub、舵机扭矩或关节位置'
  },
  'read-offsets': {
    motion: false,
    forbidden: false,
    level: 'L0',
    reason: '只读 offset.yaml / 初始姿态文件'
  },
  'prepare-offset-patch': {
    motion: false,
    forbidden: false,
    level: 'L1',
    reason: '本地生成候选 offset、补丁和人工 apply 脚本；不写机器人'
  },
  'verify-offset': {
    motion: false,
    forbidden: false,
    level: 'L0',
    reason: '只读比对 offset 文件与人工视觉确认'
  },
  'capture-calibration-photo': {
    motion: false,
    forbidden: false,
    level: 'L0',
    reason: '手机/相机拍照并保存测量记录；不动机器人'
  }
};

const CONTROL_ACTIONS = {
  'refresh-joint-positions': {
    motion: false,
    forbidden: false,
    control: true,
    level: 'L3',
    reason: '短暂占用 BodyHub 状态机（setStatus → reset）触发实测位置刷新；不运动、不改扭矩'
  }
};

const FORBIDDEN_RULES = [
  {
    re: /reboot|shutdown|poweroff|power_off|\bhalt\b/i,
    reason: '禁止自行重启或关闭机器人'
  },
  {
    re: /killall\s+(roslaunch|roscore|rosmaster)|rosnode\s+kill|\bpkill\b|kill\s+-9/i,
    reason: '禁止自行终止 ROS 进程、roslaunch 或整套系统'
  },
  {
    re: /statejump/i,
    reason: 'StateJump 会改变控制权/状态机，禁止自动执行'
  },
  {
    re: /setservolockstate|torque[_ ]?enable\s*[:=]?\s*0|servo.*lock.*0/i,
    reason: '禁止自行让关节断电/卸力'
  },
  {
    re: /setservotarposition|syncwrite|instwrite|writeregister/i,
    reason: '禁止直接写舵机目标或寄存器'
  },
  {
    re: /motoposition|headposition|jointcontrol|gaitcommand|cmd_vel|joint\/angle\/target/i,
    reason: '禁止直接发布运动话题'
  },
  {
    re: /offset\.yaml|dxlinitpose|udev|firmware|flash/i,
    reason: '禁止自行修改零位、固件或系统配置'
  }
];

const MOTION_RULES = [
  {
    re: /move|motion|teleop|walk|gait|joint|servo|head|torque|pose|trajectory|velocity|position|上电|卸力|运动|关节|头部|步态|行走|遥控|标定|回零/i,
    reason: '可能让机器人运动'
  }
];

const STOP_INSTRUCTIONS = [
  '立即停止方式（开始前必须让用户确认现场可执行）：',
  '1. 按下机器人硬件急停，或直接切断机器人电源（最可靠，优先）。',
  '2. 在发起命令的终端按 Ctrl-C，终止当前前台进程。',
  '3. 不要以关闭网页、关闭 dsh、断开 SSH 作为停止手段；断连不等于停止。',
  '4. 如果已经产生运动队列，只能使用现场验证过的停止方式；未验证前不要继续下发新指令。'
].join('\n');

function loadRules(ctx) {
  const fs = (ctx && ctx.fs) || fsDefault;
  let text = '';
  try {
    text = fs.readFileSync(ATTENTION_PATH, 'utf8');
  } catch (err) {
    throw new Error(
      `无法读取安全规则 ${ATTENTION_PATH}：${err.message}。` +
      '按 ATTENTION 规则，禁止执行任何机器人操作。'
    );
  }
  if (!String(text).trim()) {
    throw new Error(`安全规则文件为空：${ATTENTION_PATH}。禁止执行任何机器人操作。`);
  }
  return {
    path: ATTENTION_PATH,
    sha256: crypto.createHash('sha256').update(text).digest('hex'),
    loadedAt: new Date().toISOString(),
    text
  };
}

function hasIp(value) {
  if (typeof value === 'string') {
    return new RegExp(IPV4_RE.source).test(value);
  }
  if (Array.isArray(value)) {
    return value.some((item) => hasIp(item));
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (IP_KEY_RE.test(key)) return true;
      if (hasIp(item)) return true;
    }
  }
  return false;
}

function redactIps(value, seen = new WeakSet()) {
  if (typeof value === 'string') {
    return value.replace(IPV4_RE, '[REDACTED_IP]');
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactIps(item, seen));
  }
  if (value && typeof value === 'object') {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = IP_KEY_RE.test(key) ? '[REDACTED_IP]' : redactIps(item, seen);
    }
    return out;
  }
  return value;
}

function actionName(action) {
  if (typeof action === 'string') return action.trim();
  if (action && typeof action === 'object' && action.action) return String(action.action).trim();
  return '';
}

function classifyAction(action) {
  const name = actionName(action);
  if (!name) {
    return {
      action: '',
      allowed: false,
      motion: false,
      forbidden: false,
      requiresApproval: false,
      reason: '动作名为空'
    };
  }
  if (SAFE_ACTIONS[name]) {
    return {
      action: name,
      ...SAFE_ACTIONS[name],
      allowed: true,
      requiresApproval: false
    };
  }
  if (CONTROL_ACTIONS[name]) {
    return {
      action: name,
      ...CONTROL_ACTIONS[name],
      allowed: false,
      requiresApproval: true
    };
  }
  for (const rule of FORBIDDEN_RULES) {
    if (rule.re.test(name)) {
      return {
        action: name,
        allowed: false,
        motion: true,
        forbidden: true,
        requiresApproval: true,
        reason: rule.reason
      };
    }
  }
  for (const rule of MOTION_RULES) {
    if (rule.re.test(name)) {
      return {
        action: name,
        allowed: false,
        motion: true,
        forbidden: false,
        requiresApproval: true,
        reason: rule.reason
      };
    }
  }
  return {
    action: name,
    allowed: false,
    motion: false,
    forbidden: false,
    requiresApproval: false,
    reason: '不在白名单内，禁止自动执行'
  };
}

/**
 * 审查一组动作。每次调用都会重新读取 ATTENTION 文件。
 *
 * @param {Array<string|{action:string}>} actions
 * @param {{ctx?, motionApproved?, stopPlan?, rules?}} opts
 */
function reviewActions(actions, opts = {}) {
  const rules = opts.rules || loadRules(opts.ctx);
  const execute = opts.execute !== false;
  const list = (Array.isArray(actions) ? actions : [actions])
    .map(actionName)
    .filter(Boolean);
  const unique = [...new Set(list)];
  const classifications = unique.map(classifyAction);
  const violations = [];
  const warnings = [];

  for (const item of classifications) {
    if (item.forbidden) {
      violations.push({
        action: item.action,
        type: 'forbidden',
        reason: item.reason
      });
    } else if (item.control) {
      if (execute && opts.controlApproved !== true) {
        violations.push({
          action: item.action,
          type: 'control_unapproved',
          reason: '短暂占用 BodyHub 状态机读取实测位置需要用户逐次批准'
        });
      } else if (!execute) {
        warnings.push({
          action: item.action,
          type: 'control_plan_only',
          reason: 'dry-run 只展示控制读计划；真正执行前必须取得用户逐次批准'
        });
      }
    } else if (!item.motion && !item.allowed) {
      violations.push({
        action: item.action,
        type: 'unknown',
        reason: item.reason
      });
    } else if (item.motion) {
      if (execute) {
        if (opts.motionApproved !== true) {
          violations.push({
            action: item.action,
            type: 'motion_unapproved',
            reason: '运动指令缺少用户逐次批准'
          });
        }
        if (!String(opts.stopPlan || '').trim()) {
          violations.push({
            action: item.action,
            type: 'stop_missing',
            reason: '运动指令缺少“如何立即停止”的说明'
          });
        }
      } else {
        warnings.push({
          action: item.action,
          type: 'motion_plan_only',
          reason: 'dry-run 只展示计划；真正执行前必须取得用户逐次批准并给出立即停止方式'
        });
      }
    }
  }

  const motionActions = classifications
    .filter((item) => item.motion)
    .map((item) => item.action);
  const controlActions = classifications
    .filter((item) => item.control)
    .map((item) => item.action);

  return {
    rules,
    execute,
    actions: classifications,
    violations,
    warnings,
    approved: violations.length === 0,
    motionActions,
    controlActions,
    stopInstructions: motionActions.length ? STOP_INSTRUCTIONS : ''
  };
}

function assertActionAllowed(ctx, action, opts = {}) {
  const review = reviewActions([action], { ...opts, ctx });
  if (!review.approved) {
    const reasons = review.violations.map((item) => `${item.action}: ${item.reason}`).join('；');
    throw new Error(`[safety] 动作被拒绝：${reasons}`);
  }
  return review;
}

function stopInstructions() {
  return STOP_INSTRUCTIONS;
}

const id = 'safety';
const title = '执行前安全审查（读取 ATTENTION）';
const description = '每次运行重新读取 ATTENTION，审查动作是否允许、是否需要运动批准与停止方式';
const inputs = {
  actions: 'array，本次计划执行的动作（字符串或 {action}）',
  motionApproved: 'boolean，运动指令是否已获得用户逐次批准',
  stopPlan: 'string，运动指令开始前告知用户的立即停止方式',
  controlApproved: 'boolean，是否允许短暂占用 BodyHub 状态机做只读刷新',
  execute: 'boolean，默认 true；false 表示 dry-run，只给运动警告不阻止'
};

async function run(ctx, {
  actions = [],
  motionApproved = false,
  stopPlan = '',
  controlApproved = false,
  execute = true
} = {}) {
  const result = reviewActions(actions, {
    ctx, motionApproved, stopPlan, controlApproved, execute
  });
  ctx.log(
    `[safety] rules=${path.basename(result.rules.path)} ` +
    `sha256=${result.rules.sha256.slice(0, 12)} approved=${result.approved} ` +
    `actions=${result.actions.length} violations=${result.violations.length}`
  );
  for (const violation of result.violations) {
    ctx.log(`[safety][block] ${violation.action}: ${violation.reason}`);
  }
  if (result.motionActions.length) {
    ctx.log(`[safety][motion] ${result.motionActions.join(', ')}`);
    ctx.log(result.stopInstructions);
  }
  return { state: { safety: result }, ...result };
}

module.exports = {
  id,
  title,
  description,
  inputs,
  run,
  ATTENTION_PATH,
  SAFE_ACTIONS,
  CONTROL_ACTIONS,
  FORBIDDEN_RULES,
  MOTION_RULES,
  STOP_INSTRUCTIONS,
  loadRules,
  hasIp,
  redactIps,
  classifyAction,
  reviewActions,
  assertActionAllowed,
  stopInstructions
};
