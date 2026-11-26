'use strict';
/**
 * fault-units —— 把 selfcheck/diagnose 的检查项归并成「故障单元」（fault unit）。
 *
 * 为什么要归并：
 *   同一个根因会触发多条检查项（例如下巴相机故障会同时让 camera_chin、
 *   chin_camera_node、expected_nodes、dead_processes 变红）。若按检查项逐条修复，
 *   会重复执行同一个动作、互相抢资源。按组件归并后：
 *     - 一个组件一个修复单元，知识库检索也以单元为单位；
 *     - 不同组件的单元可以并行修复（各自声明资源锁）；
 *     - 无法自动修复的组件只产出人工建议，不进入并行队列。
 */

const SEVERITY_RANK = { fail: 0, warn: 1, unknown: 2, ok: 3 };

const CHECK_COMPONENT = {
  camera_chin: 'camera.chin',
  chin_camera_node: 'camera.chin',
  usb_cam_device: 'camera.chin',
  camera_color: 'camera.realsense',
  realsense_node: 'camera.realsense',
  servo_scan: 'servo.bus',
  servo_bus_errors: 'servo.bus',
  joint_cache: 'servo.bus',
  usb_servo_device: 'servo.bus',
  servo_temperature: 'servo.temperature',
  battery_voltage: 'power.battery',
  battery_topic: 'power.battery',
  imu_torso: 'sensor.imu',
  sensor_hub_temperature: 'sensor.sensorhub',
  bodyhub_state: 'control.bodyhub',
  bodyhub_owner: 'control.bodyhub',
  bodyhub_queues: 'control.bodyhub',
  disk: 'system.host',
  time_sync: 'system.host',
  ssh: 'system.ssh',
  ros_master: 'system.ros',
  expected_nodes: 'system.nodes',
  dead_processes: 'system.nodes',
  // 官方判据类检查项（出处见 knowledge/INDEX.md；判定逻辑在 skills/selfcheck.js）
  robot_model: 'system.version',
  ros_env: 'system.version',
  code_freshness: 'system.version',
  boot_autologin: 'system.boot',
  boot_autostart: 'system.boot',
  boot_window: 'system.boot',
  master_unreachable_logs: 'system.boot',
  zero_point_backup: 'calibration.zero_point',
  mic_array: 'audio.mic',
  realsense_usb: 'camera.realsense',
  chin_launch_path: 'system.nodes',
  official_check_coverage: 'sensor.sensorhub'
};

function cameraChinPredicates(probe) {
  const predicates = [{ path: 'usbCam', op: 'eq', value: 'OK' }];
  if (probe && probe.chinCameraNode && probe.chinCameraNode !== 'OK') {
    predicates.push({ path: 'chinCameraNode', op: 'eq', value: probe.chinCameraNode });
  }
  return predicates;
}

const COMPONENTS = {
  'camera.chin': {
    title: '下巴相机链路',
    autoRepairable: true,
    targets: ['camera_chin', 'chin_camera_node', 'expected_nodes'],
    locks: ['camera.chin', 'usb:camera'],
    preconditions: { bodyhubState: ['preReady', 'pause'], masterId: 0, usbCam: 'OK' },
    verification: { topic: '/chin_camera/image', minHz: 5, seconds: 5 },
    generatedPlaybook: [
      { action: 'restart-chin-camera' },
      { action: 'restart-chin-camera', retries: 1, retryDelayMs: 4000 }
    ],
    predicates: cameraChinPredicates,
    keywords: ['chin_camera', 'usb_cam', '下巴相机']
  },
  'camera.realsense': {
    title: 'RealSense 相机链路',
    autoRepairable: false,
    targets: ['camera_color', 'realsense_node', 'realsense_usb'],
    locks: ['camera.realsense', 'usb:camera'],
    manualReason: 'RealSense 不在自动修复白名单：先检查 USB3 连接、供电和驱动日志，必要时人工重启采集节点。'
  },
  'servo.bus': {
    title: '舵机总线',
    autoRepairable: false,
    targets: ['servo_bus_errors', 'servo_scan'],
    locks: ['servo.bus'],
    manualReason: '总线读错误可能是间歇性通信：检查舵机供电、USB/串口线缆、接头和总线负载；不要自动改配置或换舵机。'
  },
  'servo.temperature': {
    title: '舵机温度回读',
    autoRepairable: false,
    targets: ['servo_temperature'],
    locks: [],
    manualReason: '温度 0 是无读数，不是 0°C；确认对应 ID 是否未安装或型号不支持温度回读。'
  },
  'power.battery': {
    title: '电池供电',
    autoRepairable: false,
    targets: ['battery_voltage', 'battery_topic'],
    locks: [],
    manualReason: '电池判断以电压为准（percentage 恒为 0 是驱动未计算）；先测量/充电，不要带故障继续运行。'
  },
  'sensor.imu': {
    title: 'IMU 数据',
    autoRepairable: false,
    targets: ['imu_torso'],
    locks: [],
    manualReason: '短窗口无数据可能是事件式发布或未接入：延长监听窗口确认，长期无数据再查接线和传感器日志。'
  },
  'sensor.sensorhub': {
    title: 'SensorHub 数据',
    autoRepairable: false,
    targets: ['sensor_hub_temperature', 'official_check_coverage'],
    locks: [],
    manualReason:
      'SensorHub 温度低频/事件式发布时短窗口无数据属正常：延长监听窗口确认。' +
      '官方 check 的「脚底压感测试」等项若没有可读 topic，需人工在 VNC 终端跑 `check` 逐项确认（《Roban机器人自检手册》p.1；《Roban_教员培训手册》p.24），agent 不执行交互程序。'
  },
  'control.bodyhub': {
    title: 'BodyHub 控制状态',
    autoRepairable: false,
    targets: ['bodyhub_state', 'bodyhub_owner', 'bodyhub_queues'],
    locks: ['bodyhub'],
    manualReason: 'BodyHub 状态/控制者/队列异常时禁止自动操作：先让机器人处于空闲 preReady、无人占用控制权，再由人工确认。'
  },
  'system.host': {
    title: '主机资源与时间',
    autoRepairable: false,
    targets: ['disk', 'time_sync'],
    locks: [],
    manualReason: '主机资源/时间异常只做只读提示，不自动清理磁盘或改时间。'
  },
  'system.ros': {
    title: 'ROS Master',
    autoRepairable: false,
    targets: ['ros_master'],
    locks: [],
    manualReason: 'ROS Master 不可访问时不自动重启整套系统，需人工确认后处理。'
  },
  /* ---- 官方判据驱动的人工组件（agent 不自动改配置文件、不重启、不写零点参数） ---- */
  'system.version': {
    title: '机型与代码版本基线',
    autoRepairable: false,
    targets: ['robot_model', 'ros_env', 'code_freshness'],
    locks: [],
    manualReason:
      '《Roban机器人版本查询手册》p.1：仓库时间早于 2023-11-29 需人工执行更新脚本更新代码；' +
      'p.2：机型由 lsb_release 判定（Ubuntu 16.04 → Roban 1.0，Ubuntu 20.04 → Roban 2.0）。' +
      '版本更新/系统升级属整机改动，agent 不自动改代码仓库、不自动改配置文件、不重启，只能给出人工步骤。'
  },
  'system.boot': {
    title: '开机自动登录与自启脚本',
    autoRepairable: false,
    targets: ['boot_autologin', 'boot_autostart', 'boot_window', 'master_unreachable_logs'],
    locks: [],
    manualReason:
      '《Roban开机无法自动进入系统》p.1：需人工编辑 /etc/lightdm/lightdm.conf 增加 ' +
      'autologin-user-timeout=0；《Roban_教员培训手册》p.59-60：缺节点或 "Unable to communicate with master!" ' +
      '时需人工执行 ~/robot_ros_application/scripts/start.sh。' +
      'agent 不自动改配置文件、不自动重启 roscore/roslaunch 或整机（ATTENTION 规则 3），只给出人工步骤。'
  },
  'calibration.zero_point': {
    title: '零点参数备份（offset.yaml）',
    autoRepairable: false,
    targets: ['zero_point_backup'],
    locks: [],
    manualReason:
      '《Roban查零点步骤》p.1 / 《Roban_教员培训手册》p.37：镜像刷新前必须人工备份 ~/.lejuconfig/offset.yaml，' +
      '烧写后写回并重启。零点参数属物理标定，agent 不自动写 offset.yaml/dxlInitPose.yaml、不自动重启（ATTENTION 规则 3）。'
  },
  'audio.mic': {
    title: '麦克风阵列与语音唤醒链路',
    autoRepairable: false,
    targets: ['mic_array'],
    locks: [],
    manualReason:
      '《所有节点 topic 和 service 整理》p.2：/micarrays/wakeup 为唤醒事件式发布（《Roban拆机培训》p.7：六麦克风阵列、单条数据线）；' +
      '短窗口无数据不能直接判故障，需人工现场唤醒测试并检查排线。agent 不重启音频节点、不改配置。'
  },
  'system.nodes': {
    title: 'ROS 节点图',
    autoRepairable: false,
    targets: ['expected_nodes', 'dead_processes'],
    locks: ['ros.graph'],
    manualReason: '未归因到具体组件的节点缺失/进程退出：先看节点启动顺序和 roslaunch 日志，再决定是否重启单个非运动节点。'
  },
  'system.ssh': {
    title: 'SSH 连接',
    autoRepairable: false,
    targets: ['ssh'],
    locks: [],
    manualReason: 'SSH 本身不可用，无法远程修复；检查网络、电源和 SSH 服务。'
  }
};

const ACTION_COMPONENT = {
  'restart-chin-camera': 'camera.chin'
};

/**
 * 组件的「实时故障信号」检查项。
 *
 * dead_processes 只是 roslaunch 历史日志里的进程退出记录，修复后不会自动清零；
 * 若单元只剩这类历史证据，说明当前没有实时故障，不应触发自动重启。
 */
const LIVE_SIGNALS = {
  'camera.chin': ['camera_chin', 'chin_camera_node', 'expected_nodes', 'usb_cam_device', 'camera_color'],
  'camera.realsense': ['camera_color', 'realsense_node', 'realsense_usb', 'expected_nodes'],
  'servo.bus': ['servo_scan', 'joint_cache', 'usb_servo_device', 'servo_bus_errors'],
  'servo.temperature': ['servo_temperature'],
  'power.battery': ['battery_voltage', 'battery_topic'],
  'sensor.imu': ['imu_torso'],
  'sensor.sensorhub': ['sensor_hub_temperature', 'official_check_coverage'],
  'control.bodyhub': ['bodyhub_state', 'bodyhub_owner', 'bodyhub_queues'],
  'system.nodes': ['expected_nodes', 'ros_master', 'chin_launch_path'],
  'system.version': ['robot_model', 'ros_env', 'code_freshness'],
  'system.boot': ['boot_autologin', 'boot_autostart', 'boot_window', 'master_unreachable_logs', 'ros_master'],
  'calibration.zero_point': ['zero_point_backup'],
  'audio.mic': ['mic_array', 'expected_nodes']
};

function defaultComponent(componentId) {
  return {
    title: `未分类组件 ${componentId}`,
    autoRepairable: false,
    targets: [componentId.startsWith('misc.') ? componentId.slice(5) : componentId],
    locks: [],
    manualReason: '该检查项没有归入已知组件，按人工排查处理。'
  };
}

function routeComponent(finding, probe) {
  const checkId = finding.id;
  if (checkId === 'expected_nodes') {
    const missing = (finding.evidence && finding.evidence.missing) || [];
    // 相机优先逻辑保持不变
    if (missing.includes('/chin_camera')) return 'camera.chin';
    if (missing.some((node) => /realsense/i.test(node))) return 'camera.realsense';
    if (missing.includes('/BodyHubNodeNew')) return 'control.bodyhub';
    // 麦克风阵列节点缺失 → 音频链路（《所有节点 topic 和 service 整理》p.2：/micarrays/wakeup）
    if (missing.some((node) => /mic_array|micarrays/i.test(node))) return 'audio.mic';
    // 节点整体缺失且证据指向开机自启脚本（《教员手册》p.59：开机默认调用 scripts/start.sh）
    if (/start\.sh/i.test(String(finding.statement || '')) ||
        (finding.evidence && finding.evidence.startScript === 'MISSING')) {
      return 'system.boot';
    }
    return 'system.nodes';
  }
  if (checkId === 'dead_processes') {
    const names = String((finding.evidence && finding.evidence.names) || '');
    if (names.includes('chin_camera')) return 'camera.chin';
    if (/realsense/i.test(names)) return 'camera.realsense';
    if (/mic/i.test(names)) return 'audio.mic';
    if (/roscore|roslaunch|start\.sh/i.test(names)) return 'system.boot';
    return 'system.nodes';
  }
  return CHECK_COMPONENT[checkId] || `misc.${checkId}`;
}

function attachCandidates(units, repairCandidates) {
  for (const candidate of repairCandidates || []) {
    if (!candidate || !candidate.action) continue;
    const componentId = ACTION_COMPONENT[candidate.action];
    const unit = units.find((item) => item.id === componentId);
    if (unit) unit.repairCandidates.push(candidate);
  }
}

/**
 * @param {{probe, checks, findings, repairCandidates}} input
 * @returns {Array} 故障单元数组（按严重度排序）
 */
function build({ probe, checks = [], findings = [], repairCandidates = [] } = {}) {
  const unitMap = new Map();

  for (const finding of findings) {
    if (!finding || finding.severity === 'ok') continue;
    const componentId = routeComponent(finding, probe);
    const def = COMPONENTS[componentId] || defaultComponent(componentId);
    let unit = unitMap.get(componentId);
    if (!unit) {
      unit = {
        id: componentId,
        component: componentId,
        title: def.title,
        severity: finding.severity,
        checks: [],
        findings: [],
        targets: (def.targets || []).slice(),
        autoRepairable: def.autoRepairable === true,
        manualReason: def.manualReason || '',
        locks: (def.locks || []).slice(),
        preconditions: def.preconditions || null,
        verification: def.verification || null,
        generatedPlaybook: (def.generatedPlaybook || []).slice(),
        predicates: def.predicates ? def.predicates(probe) : [],
        keywords: (def.keywords || []).slice(),
        repairCandidates: []
      };
      unitMap.set(componentId, unit);
    }
    if (!unit.checks.includes(finding.id)) unit.checks.push(finding.id);
    unit.findings.push(finding);
    if (SEVERITY_RANK[finding.severity] < SEVERITY_RANK[unit.severity]) {
      unit.severity = finding.severity;
    }
  }

  const units = [...unitMap.values()];
  attachCandidates(units, repairCandidates);

  // 只有实时故障信号才允许自动修复；仅历史日志证据 → 降级为人工观察
  for (const unit of units) {
    const liveChecks = LIVE_SIGNALS[unit.id];
    if (!liveChecks || !unit.autoRepairable) continue;
    const hasLiveSignal = unit.findings.some((finding) => liveChecks.includes(finding.id));
    if (!hasLiveSignal) {
      unit.autoRepairable = false;
      unit.manualReason =
        '只有历史日志中的进程退出记录，没有实时故障信号（节点/设备/话题均正常）；先观察，不自动重启。';
    }
  }

  units.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  return units;
}

module.exports = {
  SEVERITY_RANK,
  CHECK_COMPONENT,
  COMPONENTS,
  ACTION_COMPONENT,
  routeComponent,
  build
};
