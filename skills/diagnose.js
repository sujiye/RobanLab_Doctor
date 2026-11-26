'use strict';
/**
 * diagnose —— 基于检查项生成候选原因、修复候选和人工待办。
 *
 * 这是确定性规则层，不调用大模型。dsh 可以在之后用 LLM 对同一份证据做解释，
 * 但“能不能修、修哪一步”由这里的规则和 repair 白名单决定。
 */

const id = 'diagnose';
const title = '故障归因与修复候选';
const description = '返回 findings / hypotheses / repairCandidates / needsUserInput';
const inputs = {
  probe: 'env-probe 的输出',
  checks: 'selfcheck 的输出'
};

const CATEGORY = {
  camera_chin: 'software',
  chin_camera_node: 'software',
  expected_nodes: 'software',
  dead_processes: 'software',
  servo_bus_errors: 'hardware',
  servo_temperature: 'hardware',
  battery_voltage: 'power',
  battery_topic: 'sensor',
  imu_torso: 'sensor',
  sensor_hub_temperature: 'sensor',
  bodyhub_state: 'control',
  bodyhub_owner: 'control',
  bodyhub_queues: 'control',
  // 官方判据类检查项（出处见 knowledge/INDEX.md）
  robot_model: 'version',
  ros_env: 'version',
  code_freshness: 'version',
  boot_autologin: 'boot',
  boot_autostart: 'boot',
  boot_window: 'boot',
  master_unreachable_logs: 'boot',
  zero_point_backup: 'calibration',
  realsense_usb: 'hardware',
  chin_launch_path: 'software',
  mic_array: 'sensor'
};

const SEVERITY_ORDER = { fail: 0, warn: 1, unknown: 2, ok: 3 };

/* 官方阈值：《Roban机器人版本查询手册》p.1（仓库时间早于 2023-11-29 需人工执行更新脚本） */
const CODE_CUTOVER_DATE = '2023-11-29';

function pick(checks, checkId) {
  return checks.find((c) => c.id === checkId) || null;
}

function pushTodo(needsUserInput, text) {
  if (!needsUserInput.includes(text)) needsUserInput.push(text);
}

function build(probe, checks) {
  const findings = checks
    .filter((c) => c.status !== 'ok')
    .map((c) => ({
      id: c.id,
      severity: c.status,
      category: CATEGORY[c.id] || 'other',
      statement: c.detail,
      evidence: c.evidence || null,
      confidence: c.status === 'fail' ? 'high' : c.status === 'warn' ? 'medium' : 'low'
    }))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  const hypotheses = [];
  const repairCandidates = [];
  const needsUserInput = [];

  const chin = pick(checks, 'camera_chin');
  const chinNode = pick(checks, 'chin_camera_node');
  if (chin && chin.status === 'fail') {
    hypotheses.push({
      id: 'chin-camera-startup-order',
      statement:
        '下巴相机节点可能在 /dev/usb_cam 建立之前启动，随后退出；' +
        '设备节点现在存在，重启非运动相机节点可以验证这个假设。',
      evidence: [
        `camera_chin=${chin.status}`,
        `chin_camera_node=${chinNode ? chinNode.status : 'unknown'}`,
        `usb_cam=${probe.usbCam}`,
        `dead_processes=${probe.logs.deadProcesses}`
      ],
      confidence: 'high'
    });

    const stateOk = ['preReady', 'pause'].includes(probe.bodyhubState);
    const ownerOk = probe.masterId === 0;
    if (probe.usbCam === 'OK' && stateOk && ownerOk) {
      repairCandidates.push({
        action: 'restart-chin-camera',
        level: 'L2',
        title: '重启下巴相机节点',
        reason: '非运动节点重启；不触碰 BodyHub、舵机扭矩或关节位置。',
        preconditions: {
          bodyhub_state: probe.bodyhubState,
          master_id: probe.masterId,
          usb_cam: probe.usbCam
        },
        verification: {
          topic: '/chin_camera/image',
          min_hz: 5,
          min_seconds: 5
        },
        automatic: false,
        requires_confirm: true
      });
    } else {
      needsUserInput.push(
        '下巴相机当前不满足安全重启条件（BodyHub 状态/控制者/设备）。' +
        '请先确认机器人处于空闲状态并无人占用控制权。'
      );
    }
  }

  const bus = pick(checks, 'servo_bus_errors');
  if (bus && bus.status === 'warn') {
    const scanOk = pick(checks, 'servo_scan');
    hypotheses.push({
      id: 'servo-bus-intermittent',
      statement:
        scanOk && scanOk.status === 'ok'
          ? '总线仍能扫描到全部舵机，读错误更像间歇性通信问题，优先检查供电、线缆、接头和总线负载。'
          : '总线读错误且扫描不完整，需要同时检查缺号舵机的供电和接线。',
      evidence: [
        `dxl_bulk_read_errors=${probe.logs.dxlBulkReadErrors}`,
        `servo_scan=${scanOk ? scanOk.status : 'unknown'}`
      ],
      confidence: scanOk && scanOk.status === 'ok' ? 'medium' : 'high'
    });
    needsUserInput.push('检查舵机供电、USB/串口线缆、接头和总线负载；不要自动修改配置或更换舵机。');
  }

  const temp = pick(checks, 'servo_temperature');
  if (temp && temp.status === 'warn') {
    hypotheses.push({
      id: 'servo-temperature-zero-readings',
      statement: '部分舵机 ID 返回 0 温度，这是“无读数”，不是 0°C；需要结合舵机型号和是否安装判断。',
      evidence: [`zero_ids=${(probe.tempZeroIds || []).join(',')}`],
      confidence: 'medium'
    });
    needsUserInput.push('确认无温度读数的 ID 是否为本机未安装或型号不支持温度回读的舵机。');
  }

  for (const sensorId of ['imu_torso', 'sensor_hub_temperature']) {
    const c = pick(checks, sensorId);
    if (c && c.status === 'unknown') {
      hypotheses.push({
        id: `${sensorId}-no-data`,
        statement: '短窗口内没有数据，可能是低频/事件式发布，也可能是传感器未接入；不能直接判故障。',
        evidence: [`${sensorId}=unknown`],
        confidence: 'low'
      });
    }
  }

  const battery = pick(checks, 'battery_voltage');
  if (battery && battery.status !== 'ok') {
    needsUserInput.push('测量/充电电池；电池判断以电压为准，不使用 percentage。');
  }

  /* ------------------------------------------------------------------ *
   * 官方判据归因（出处见 knowledge/INDEX.md → knowledge/manuals/text/*）
   * 只产出「假设 + 人工待办」：白名单动作只有 restart-chin-camera，
   * 改配置文件 / 重启 roscore / 写 offset.yaml / 拔插 USB 一律转人工
   * （ATTENTION/ATTENTION.md 规则 2、3）。
   * ------------------------------------------------------------------ */

  const boot = probe.boot || {};
  const zeroPoint = probe.zeroPoint || {};
  const usb = probe.usb || {};
  const rates = probe.rates || {};
  const repo = probe.repo || {};

  const freshness = pick(checks, 'code_freshness');
  if (freshness && freshness.status !== 'ok') {
    hypotheses.push({
      id: 'code-outdated-before-cutover',
      statement:
        `代码仓库 ${repo.dir || 'MISSING'} 最近提交时间 ${repo.commitDate || '不可读'} ` +
        `早于官方阈值 ${CODE_CUTOVER_DATE}（或无法读取）：《Roban机器人版本查询手册》p.1 要求人工执行更新脚本更新仓库代码；` +
        'agent 不自动更新代码、不重启机器人。',
      evidence: [
        `repo.dir=${repo.dir || 'MISSING'}`,
        `repo.commitDate=${repo.commitDate || 'null'}`,
        `robotModel=${probe.robotModel || 'UNKNOWN'} (osRelease=${probe.osRelease || '未知'})`,
        `rosDistro=${probe.rosDistro || 'UNKNOWN'}`
      ],
      confidence: freshness.status === 'warn' ? 'high' : 'medium'
    });
    pushTodo(
      needsUserInput,
      '人工待办（agent 不执行）：按《Roban机器人版本查询手册》p.1 在机器人终端执行 ' +
      'cd ~/robot_ros_application && git log 确认仓库时间；若早于 2023-11-29，按手册给出的更新脚本命令手动更新代码，' +
      '完成后重跑 selfcheck 复检 code_freshness。机型判定见《版本查询手册》p.2（lsb_release -a：16.04→Roban 1.0，20.04→Roban 2.0）。'
    );
  }

  const autologin = pick(checks, 'boot_autologin');
  if (autologin && autologin.status !== 'ok') {
    hypotheses.push({
      id: 'boot-autologin-missing',
      statement:
        `开机需手动登录：/etc/lightdm/lightdm.conf 状态 ${boot.lightdm || 'MISSING'}，` +
        `autologin-user=${boot.autologinUser || '空'}，autologin-user-timeout=${boot.autologinTimeout || '空'}。` +
        '《Roban开机无法自动进入系统》p.1 的官方处理是人工编辑该文件；agent 不自动改配置文件、不重启。',
      evidence: [
        `lightdm=${boot.lightdm || 'MISSING'}`,
        `autologinUser=${boot.autologinUser || '空'}`,
        `autologinTimeout=${boot.autologinTimeout || '空'}`
      ],
      confidence: autologin.status === 'warn' ? 'high' : 'medium'
    });
    pushTodo(
      needsUserInput,
      '人工待办（agent 不执行）：按《Roban开机无法自动进入系统》p.1 在机器人上执行 sudo nano /etc/lightdm/lightdm.conf，' +
      '在 autologin-user=lemon 下一行添加 autologin-user-timeout=0，保存后由用户手动重启，再重跑 selfcheck 复检 boot_autologin。'
    );
  }

  const autostart = pick(checks, 'boot_autostart');
  if (autostart && autostart.status !== 'ok') {
    hypotheses.push({
      id: 'boot-autostart-missing',
      statement:
        `开机自启脚本 ${boot.startScript || 'MISSING'}，roscore/roslaunch 进程 ${boot.roscoreProcs || 0} 个，` +
        `ROS Master=${probe.rosMaster || 'FAIL'}：《Roban_教员培训手册》p.59 说明开机默认调用 ` +
        '~/robot_ros_application/scripts/start.sh，脚本缺失或未执行会导致节点图不完整；' +
        '官方处理是人工执行该脚本，agent 不自动重启 roscore/roslaunch 或整机（ATTENTION 规则 3）。',
      evidence: [
        `startScript=${boot.startScript || 'MISSING'}`,
        `roscoreProcs=${boot.roscoreProcs || 0}`,
        `rosMaster=${probe.rosMaster || 'FAIL'}`,
        `bootWindow=${(pick(checks, 'boot_window') || {}).status || 'unknown'}`
      ],
      confidence: autostart.status === 'fail' ? 'high' : 'medium'
    });
    pushTodo(
      needsUserInput,
      '人工待办（agent 不执行）：按《Roban_教员培训手册》p.59 在机器人终端（前台，可 Ctrl-C）执行 ' +
      'bash ~/robot_ros_application/scripts/start.sh，然后用 rosnode list 确认节点是否齐全；不要 killall roslaunch 或重启整机。'
    );
  }

  const masterLogs = pick(checks, 'master_unreachable_logs');
  if (masterLogs && masterLogs.status !== 'ok') {
    const count = (masterLogs.evidence && masterLogs.evidence.count) || 0;
    hypotheses.push({
      id: 'ros-master-not-started',
      statement:
        `日志中出现 ${count} 次 "Unable to communicate with master!"，与 ROS Master 不可访问/自启脚本未执行一致：` +
        '《Roban_教员培训手册》p.60 的官方处理是人工执行 ~/robot_ros_application/scripts/start.sh；' +
        '禁止自动 killall roslaunch、重启 roscore 或整机（ATTENTION 规则 3）。',
      evidence: [
        `masterUnreachableLogs=${count}`,
        `rosMaster=${probe.rosMaster || 'FAIL'}`,
        `roscoreProcs=${boot.roscoreProcs || 0}`,
        `startScript=${boot.startScript || 'MISSING'}`
      ],
      confidence: probe.rosMaster === 'OK' ? 'medium' : 'high'
    });
    pushTodo(
      needsUserInput,
      '人工待办（agent 不执行）：按《Roban_教员培训手册》p.60 人工执行 ~/robot_ros_application/scripts/start.sh，' +
      '并检查开机自启是否生效（《教员手册》p.59：rosnode list 确认）；若反复出现，人工确认后再重跑 selfcheck 复检 master_unreachable_logs。'
    );
  }

  const zeroPointCheck = pick(checks, 'zero_point_backup');
  if (zeroPointCheck && zeroPointCheck.status !== 'ok') {
    hypotheses.push({
      id: 'zero-point-backup-missing',
      statement:
        `零点参数文件 ~/.lejuconfig/offset.yaml 状态 ${zeroPoint.officialOffset || 'MISSING'}` +
        `（${zeroPoint.officialOffsetLines || 0} 行，楼梯偏移文件 ${zeroPoint.stairOffset || 'MISSING'}）：` +
        '《Roban查零点步骤》p.1 要求人工查看并拍照/截图保存零点参数，《Roban_教员培训手册》p.37 说明镜像刷新前必须备份并写回 offset.yaml；' +
        'agent 不自动写 offset.yaml/dxlInitPose.yaml、不重启（ATTENTION 规则 3）。',
      evidence: [
        `officialOffset=${zeroPoint.officialOffset || 'MISSING'}`,
        `officialOffsetLines=${zeroPoint.officialOffsetLines || 0}`,
        `stairOffset=${zeroPoint.stairOffset || 'MISSING'}`,
        `zero_point_backup=${zeroPointCheck.status}`
      ],
      confidence: zeroPointCheck.status === 'warn' ? 'high' : 'medium'
    });
    pushTodo(
      needsUserInput,
      '人工待办（agent 不执行）：按《Roban查零点步骤》p.1 在机器人上执行 cd ~/.lejuconfig && sudo gedit offset.yaml，' +
      '拍照/截图保存当前零点参数；若计划刷新镜像（《离线镜像刷新手册》p.1 前提），先备份 offset.yaml，烧写后写回并重启。'
    );
  }

  const rsUsb = pick(checks, 'realsense_usb');
  if (rsUsb && rsUsb.status !== 'ok') {
    hypotheses.push({
      id: 'realsense-usb-missing',
      statement:
        `lsusb 未看到 RealSense（USB 设备总数 ${usb.deviceCount || 0}）：《ROBAN机器人使用入门》p.6 规格为 Intel RealSense d435 深度摄像头，` +
        '缺失通常是 USB3 线缆/接口/供电问题；agent 不自动拔插、不重启采集节点，需人工现场确认。',
      evidence: [
        `realsense_usb=${usb.realsense || 'MISSING'}`,
        `usb_device_count=${usb.deviceCount || 0}`,
        `realsense_node=${probe.realsenseNode || 'UNREACHABLE'}`
      ],
      confidence: probe.realsenseNode === 'OK' ? 'medium' : 'high'
    });
    pushTodo(
      needsUserInput,
      '人工待办（agent 不执行）：人工检查 RealSense 的 USB3 线缆、接口与供电（《使用入门》p.6 规格），' +
      '重新插拔后由用户确认，再重跑 selfcheck 复检 realsense_usb / camera_color。'
    );
  }

  const mic = pick(checks, 'mic_array');
  if (mic && mic.status !== 'ok') {
    hypotheses.push({
      id: 'mic-array-no-wakeup',
      statement:
        `/micarrays/wakeup 短窗口无数据（实测 ${rates.micWakeup === null || rates.micWakeup === undefined ? '无数据' : rates.micWakeup.toFixed(1) + ' Hz'}）：` +
        '《所有节点 topic 和 service 整理》p.2 说明该 topic 为唤醒事件式发布，无数据不等于链路故障；' +
        '《Roban拆机培训》p.7 说明麦克风阵列为 6 个麦克风共用一条数据线，排线松动会导致无数据。需人工现场唤醒测试确认，agent 不重启音频节点。',
      evidence: [
        `micWakeup=${rates.micWakeup === null || rates.micWakeup === undefined ? 'null' : rates.micWakeup.toFixed(1)}`,
        `bodyhubStatus=${rates.bodyhubStatus === null || rates.bodyhubStatus === undefined ? 'null' : rates.bodyhubStatus.toFixed(1)}`,
        `mic_array=${mic.status}`
      ],
      confidence: 'low'
    });
    pushTodo(
      needsUserInput,
      '人工待办（agent 不执行）：现场对机器人说唤醒词，同时用 rostopic hz /micarrays/wakeup 观察是否有消息；' +
      '若始终无数据，按《Roban拆机培训》p.7 人工检查六麦克风阵列数据线（拆机属人工操作，agent 不执行）。'
    );
  }

  return { findings, hypotheses, repairCandidates, needsUserInput };
}

async function run(ctx, { probe, checks } = {}) {
  if (!probe || !Array.isArray(checks)) {
    throw new Error('diagnose 需要 probe 和 checks');
  }
  const result = build(probe, checks);
  ctx.log(
    `[diagnose] findings=${result.findings.length} ` +
    `repairs=${result.repairCandidates.map((r) => r.action).join(',') || 'none'}`
  );
  return {
    state: {
      findings: result.findings,
      hypotheses: result.hypotheses,
      repairCandidates: result.repairCandidates,
      needsUserInput: result.needsUserInput
    },
    ...result
  };
}

module.exports = { id, title, description, inputs, run, build };
