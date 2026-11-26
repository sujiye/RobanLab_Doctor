'use strict';
/**
 * general-hypothesis —— 把自然语言 + 视觉观察 + 只读软件证据合成候选原因。
 *
 * 这是规则层，不调用视觉模型；视觉 observations 由 agent 先填好。
 * 输出只包含候选原因、下一步检查和白名单安全动作，不直接执行修复。
 */

const diagnose = require('./diagnose.js');
const repair = require('./repair.js');

const id = 'general-hypothesis';
const title = '多证据故障归因';
const description = '合并症状标签、视觉观察、probe/selfcheck，输出候选原因和安全动作';
const inputs = {
  description: 'string，用户原话',
  symptom: 'symptom-intake 输出',
  visualEvidence: 'visual-evidence 输出',
  probe: 'env-probe 输出（可选）',
  checks: 'selfcheck 输出（可选）'
};

function hasTag(symptom, tag) {
  return Boolean(symptom && Array.isArray(symptom.tags) && symptom.tags.includes(tag));
}

function visualText(visualEvidence) {
  if (!visualEvidence) return '';
  const observations = visualEvidence.visionObservations;
  return [
    observations ? JSON.stringify(observations) : '',
    ...(visualEvidence.captures || []).map((item) => item.note || '')
  ].join(' ');
}

function checkOf(checks, checkId) {
  return (checks || []).find((item) => item.id === checkId) || null;
}

function addHypothesis(list, item) {
  if (!item || !item.id) return;
  if (list.some((existing) => existing.id === item.id)) return;
  list.push({
    category: 'other',
    confidence: 'low',
    evidence: [],
    nextChecks: [],
    safeActions: [],
    manualActions: [],
    recommendedWorkflow: null,
    ...item
  });
}

function safeAction(action, reason) {
  if (!repair.ACTIONS || !repair.ACTIONS[action]) return null;
  return {
    action,
    level: 'L2',
    reason,
    requiresConfirm: true
  };
}

function build({ description, symptom, visualEvidence, probe, checks } = {}) {
  const hypotheses = [];
  const needsUserInput = [];
  const visual = visualText(visualEvidence).toLowerCase();
  const hasImage = Boolean(visualEvidence && visualEvidence.ready);
  const hasEvidence = Boolean(probe && checks);

  if (symptom && symptom.redFlags) {
    addHypothesis(hypotheses, {
      id: 'general-safety-red-flag',
      cause: '描述包含冒烟/焦味/过热/跌落等高风险信号，先停止运行并人工检查。',
      category: 'safety',
      confidence: 'high',
      evidence: [description || '', 'redFlags=true'],
      manualActions: [
        '立即停止运动，人工断开电源/急停（由用户操作）。',
        '检查是否有冒烟、焦味、发烫、线缆破损或机械变形。',
        '在排除安全风险前不要继续诊断、不要重新上电运行。'
      ]
    });
    return { hypotheses, needsUserInput, safeActions: [], recommendedWorkflow: null };
  }

  const cameraCheck = checkOf(checks, 'camera_chin');
  const cameraProblem = hasTag(symptom, 'camera') ||
    (cameraCheck && cameraCheck.status !== 'ok') ||
    /黑屏|没有画面|画面黑|花屏|无图像|camera.*fail/.test(visual);

  if (cameraProblem) {
    const canRestart = probe && probe.usbCam === 'OK' && probe.chinCameraNode !== 'OK';
    const actions = canRestart
      ? [safeAction('restart-chin-camera', '设备节点存在、相机节点失联；重启非运动节点验证。')].filter(Boolean)
      : [];
    addHypothesis(hypotheses, {
      id: 'general-camera-pipeline',
      cause: canRestart
        ? '下巴相机链路：设备存在但节点失联，可能是启动竞态或 usb_cam 退出。'
        : '相机链路异常：需要先区分设备缺失、驱动未启动、话题无数据或画面本身黑屏。',
      category: 'software',
      confidence: canRestart ? 'high' : (hasImage ? 'medium' : 'low'),
      evidence: [
        `camera_chin=${cameraCheck ? cameraCheck.status : 'unknown'}`,
        `usb_cam=${probe ? probe.usbCam : 'unknown'}`,
        `chin_node=${probe ? probe.chinCameraNode : 'unknown'}`,
        hasImage ? '已有现场图片' : '没有现场图片'
      ],
      nextChecks: [
        '确认是头部 RealSense 还是下巴相机。',
        '检查 /dev/usb_cam 是否存在、节点是否可访问、话题频率是否 >5Hz。',
        '查看 rosout 中 usb_cam/VIDIOC 相关错误。'
      ],
      safeActions: actions,
      manualActions: actions.length ? [] : [
        '检查相机 USB 线缆/接口；设备缺失时先处理硬件连接。',
        '如果是头部 RealSense，检查 USB3 连接和供电。'
      ],
      recommendedWorkflow: actions.length ? 'roban-auto-repair' : null
    });
  }

  if (hasTag(symptom, 'zero')) {
    addHypothesis(hypotheses, {
      id: 'general-zero-offset',
      cause: '关节零点/offset 偏移：软件缓存角与机械零位不一致，或舵机臂齿位/装配偏移。',
      category: 'calibration',
      confidence: hasImage ? 'medium' : 'low',
      evidence: [
        '用户描述包含零位/角度偏移',
        hasEvidence ? '已有 probe/selfcheck 证据' : '没有软件证据'
      ],
      nextChecks: [
        '先确认是哪个关节 ID：可用 joint-identify 的 baseline/diff 流程。',
        '人工把关节放到正确零点，再读取软件角度。',
        '检查偏差是否随方向/负载变化；若变化明显，优先查机械装配而不是加大 offset。'
      ],
      manualActions: [
        '支撑手臂，人工把关节放到参考零位。',
        '需要短暂控制读时，必须逐次批准；不做运动/卸力。'
      ],
      recommendedWorkflow: 'roban-zero-calibration',
      recommendedCommand: 'node workflow/joint-identify-adapter.js baseline --control-approved'
    });
  }

  if (hasTag(symptom, 'arm') || hasTag(symptom, 'motion')) {
    const scan = checkOf(checks, 'servo_scan');
    const bus = checkOf(checks, 'servo_bus_errors');
    addHypothesis(hypotheses, {
      id: 'general-arm-mechanical',
      cause: '手臂关节无力/下垂/卡住：可能是上电/扭矩、机械卡阻、线缆/接头或零点问题；仅凭图片不能断定电机损坏。',
      category: 'hardware',
      confidence: hasImage ? 'medium' : 'low',
      evidence: [
        `servo_scan=${scan ? scan.status : 'unknown'}`,
        `servo_bus_errors=${bus ? bus.status : 'unknown'}`,
        hasImage ? '已有现场图片' : '没有现场图片'
      ],
      nextChecks: [
        '支撑手臂，确认关节是否能被手动自由转动（不要强行用力）。',
        '运行 ScanServo，确认对应 ID 是否在线。',
        '检查该关节的供电、线缆、接头和舵机温度。',
        '如果只是角度不准而不是无力，转 zero-offset 流程。'
      ],
      manualActions: [
        '先支撑手臂，避免卸力/误动作导致跌落。',
        '不要由 agent 执行上电/卸力/关节运动；需要释放关节时由用户按厂家安全流程手动操作。'
      ]
    });
  }

  if (hasTag(symptom, 'gait')) {
    addHypothesis(hypotheses, {
      id: 'general-gait-balance',
      cause: '行走/平衡异常：可能涉及电池电压、IMU、脚底传感器、步态参数或机械干涉。',
      category: 'control',
      confidence: 'low',
      evidence: ['用户描述包含行走/平衡/摔倒'],
      nextChecks: [
        '检查电池电压、IMU 数据、脚底 FSR 和步态参数。',
        '在支撑条件下复现，禁止直接让机器人自由行走。'
      ],
      manualActions: ['先支撑/吊挂机器人，不要自动执行步态或站立动作。']
    });
  }

  if (hasTag(symptom, 'battery')) {
    addHypothesis(hypotheses, {
      id: 'general-battery-power',
      cause: '电池/供电异常：电压不足、接触不良或充放电问题。',
      category: 'power',
      confidence: 'medium',
      evidence: [
        `battery_voltage=${probe && probe.battery ? probe.battery.voltage : 'unknown'}`
      ],
      nextChecks: ['读取 BatteryState 电压，检查充电器和电池接头。'],
      manualActions: ['先充电/测量电压，不要带低电压继续运行。']
    });
  }

  if (hasTag(symptom, 'network')) {
    addHypothesis(hypotheses, {
      id: 'general-network-ssh',
      cause: '网络/SSH 不可达：机器人未开机、Wi-Fi 断开、IP 变化或 sshd 未启动。',
      category: 'network',
      confidence: 'medium',
      evidence: ['用户描述包含连接/网络问题'],
      nextChecks: ['确认机器人电源和 Wi-Fi；重新向用户确认当前 IP。'],
      manualActions: ['不要扫描网段或猜测 IP；让用户提供当前地址。']
    });
  }

  if (hasTag(symptom, 'audio')) {
    addHypothesis(hypotheses, {
      id: 'general-audio',
      cause: '语音/音频链路异常：麦克风、声卡、语音服务或喇叭。',
      category: 'audio',
      confidence: 'low',
      evidence: ['用户描述包含声音/语音问题'],
      nextChecks: ['检查 arecord 设备、语音节点和音量设置。'],
      manualActions: ['先确认是听不到、说不出，还是识别错误。']
    });
  }

  if (hasTag(symptom, 'software') || (hasEvidence && checks.some((c) => c.status === 'fail'))) {
    const diagnosis = hasEvidence ? diagnose.build(probe, checks) : { findings: [], hypotheses: [], repairCandidates: [] };
    for (const item of diagnosis.hypotheses || []) {
      addHypothesis(hypotheses, {
        id: item.id,
        cause: item.statement,
        category: 'software',
        confidence: item.confidence || 'medium',
        evidence: item.evidence || [],
        nextChecks: ['参考 selfcheck 对应检查项和 rosout 日志。'],
        safeActions: (diagnosis.repairCandidates || [])
          .filter((candidate) => candidate.action)
          .map((candidate) => safeAction(candidate.action, candidate.reason || candidate.title))
          .filter(Boolean)
      });
    }
  }

  if (!hypotheses.length) {
    addHypothesis(hypotheses, {
      id: 'general-unclassified',
      cause: '现有描述/图片/软件证据不足以归因，需要补充信息。',
      category: 'unknown',
      confidence: 'low',
      evidence: [description || '无描述'],
      nextChecks: [
        '补充异常发生的时间、部位、声音/气味/屏幕报错。',
        '拍一张包含异常部位和机器人整体姿态的照片。',
        '如果机器人可连接，运行 selfcheck 获取只读证据。'
      ],
      manualActions: ['先不要执行任何运动或重启。']
    });
  }

  if (visualEvidence && visualEvidence.missing && visualEvidence.missing.length) {
    needsUserInput.push(...visualEvidence.missing);
  }
  if (symptom && symptom.questions && symptom.questions.length) {
    needsUserInput.push(...symptom.questions);
  }

  const safeActions = [];
  for (const hypothesis of hypotheses) {
    for (const action of hypothesis.safeActions || []) {
      if (!safeActions.some((item) => item.action === action.action)) safeActions.push(action);
    }
  }

  const recommendedWorkflow = hypotheses
    .map((item) => item.recommendedWorkflow)
    .find(Boolean) || null;

  return {
    hypotheses,
    safeActions,
    recommendedWorkflow,
    needsUserInput: [...new Set(needsUserInput)],
    summary: {
      total: hypotheses.length,
      critical: hypotheses.filter((h) => h.category === 'safety').length,
      safeActions: safeActions.length
    }
  };
}

async function run(ctx, input = {}) {
  const result = build(input);
  ctx.log(
    `[general-hypothesis] hypotheses=${result.hypotheses.length} ` +
    `safe_actions=${result.safeActions.map((a) => a.action).join(',') || 'none'} ` +
    `recommended=${result.recommendedWorkflow || '-'}`
  );
  return {
    state: { generalDiagnosis: result, safeActions: result.safeActions },
    ...result
  };
}

module.exports = { id, title, description, inputs, run, build, visualText };
