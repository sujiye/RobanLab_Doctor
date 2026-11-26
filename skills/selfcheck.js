'use strict';
/**
 * selfcheck —— 把 env-probe 的原始数据转成可审计的检查项。
 *
 * 判定原则：
 *  - 没有数据 ≠ 正常，标 UNKNOWN；
 *  - BodyHub 话题是事件式发布，短窗口无消息不能直接判故障；
 *  - GetJointAngle 是软件缓存角，不是电机实测；
 *  - 温度 0 是无读数，不是 0°C；电池用电压，不用 percentage。
 */

const id = 'selfcheck';
const title = '规则化自检判定';
const description = '返回 checks[] 与 ok/warn/fail/unknown 汇总';
const inputs = { probe: 'env-probe 的输出对象' };

const EXPECTED_NODES = [
  '/BodyHubNodeNew',
  '/SensorHubNode',
  '/camera/realsense2_camera',
  '/camera/realsense2_camera_manager',
  '/head_toward_sound',
  '/ik_module_node',
  '/joystick_handle_node',
  '/keyboards_node',
  '/mqtt_node',
  '/ros_aiui_node',
  '/ros_broadcast_node',
  '/ros_color_node',
  '/ros_face_node',
  '/ros_gesture_node',
  '/ros_label_node',
  '/ros_msg_node',
  '/ros_socket_node',
  '/rosout',
  '/slam_mapping_node',
  '/vision_node',
  '/web_video_server',
  '/chin_camera'
];

const SERVO_IDS = Array.from({ length: 22 }, (_, i) => i + 1);

/* 官方基线（出处见 knowledge/INDEX.md 与 knowledge/official-baseline.json）
 *  - 《Roban机器人版本查询手册》p.1-2：Ubuntu 16.04 → Roban 1.0，20.04 → Roban 2.0；
 *    仓库时间早于 2023-11-29 需更新代码。
 *  - 《使用入门》p.12 / 《教员手册》p.4：上电约 40 s 后全舵机加锁并恢复初始站立姿态。
 *  - 《开机无法自动进入系统》p.1：lightdm 缺 autologin-user-timeout 导致开机需手动登录。
 *  - 《查零点步骤》p.1 / 《教员手册》p.37：零点参数在 ~/.lejuconfig/offset.yaml，
 *    镜像刷新前必须备份。
 *  - 《教员手册》p.59-60：开机默认调用 scripts/start.sh；缺 bodyhub/realsense 节点或
 *    "Unable to communicate with master!" 时需人工执行 start.sh（禁止自动重启）。 */
const CODE_CUTOVER_DATE = '2023-11-29';
const BOOT_GRACE_SECONDS = 120;

function officialBaselineChecks(probe) {
  const items = [];

  const model = probe.robotModel || 'UNKNOWN';
  items.push({
    id: 'robot_model',
    status: model === 'UNKNOWN' ? 'unknown' : 'ok',
    detail:
      model === 'UNKNOWN'
        ? '无法识别机型（lsb_release 无输出）'
        : `机型 ${model}（${probe.osRelease || '未知系统'}，ROS ${probe.rosDistro}）`,
    evidence: { osRelease: probe.osRelease, rosDistro: probe.rosDistro }
  });

  if (probe.rosDistro === 'UNKNOWN' || !probe.rosDistro) {
    items.push({
      id: 'ros_env',
      status: probe.rosMaster === 'OK' ? 'warn' : 'unknown',
      detail: 'ROS 环境未识别（探测脚本按 kinetic/noetic/melodic 回退，仍未找到 ROS_DISTRO）'
    });
  } else {
    items.push({
      id: 'ros_env',
      status: 'ok',
      detail: `ROS 发行版：${probe.rosDistro}`
    });
  }

  const repoDate = probe.repo && probe.repo.commitDate;
  if (probe.repo && probe.repo.dir === 'MISSING') {
    items.push({
      id: 'code_freshness',
      status: 'warn',
      detail: '没有 ~/robot_ros_application 代码仓库；官方要求程序更新（《教员手册》p.9-10）'
    });
  } else if (!repoDate) {
    items.push({
      id: 'code_freshness',
      status: 'unknown',
      detail: '无法读取代码仓库时间（git 不可用或仓库无提交）'
    });
  } else if (repoDate < CODE_CUTOVER_DATE) {
    items.push({
      id: 'code_freshness',
      status: 'warn',
      detail:
        `代码仓库时间 ${repoDate} 早于官方阈值 ${CODE_CUTOVER_DATE}，建议人工执行更新脚本（《版本查询手册》p.1）`,
      evidence: { commitDate: repoDate, commit: probe.repo.commit }
    });
  } else {
    items.push({
      id: 'code_freshness',
      status: 'ok',
      detail: `代码仓库时间 ${repoDate}，符合官方要求`,
      evidence: { commitDate: repoDate, commit: probe.repo.commit }
    });
  }

  const boot = probe.boot || {};
  if (boot.lightdm === 'MISSING') {
    items.push({
      id: 'boot_autologin',
      status: 'unknown',
      detail: '没有 /etc/lightdm/lightdm.conf，无法判断自动登录配置'
    });
  } else if (!boot.autologinUser) {
    items.push({
      id: 'boot_autologin',
      status: 'warn',
      detail:
        'lightdm 未配置 autologin-user：官方已知现象是开机后需接鼠标/键盘手动登录（《开机无法自动进入系统》p.1）',
      evidence: { autologinUser: boot.autologinUser, autologinTimeout: boot.autologinTimeout }
    });
  } else if (!boot.autologinTimeout) {
    items.push({
      id: 'boot_autologin',
      status: 'warn',
      detail:
        `autologin-user=${boot.autologinUser} 但缺少 autologin-user-timeout=0，仍可能需手动登录（《开机无法自动进入系统》p.1）`,
      evidence: { autologinUser: boot.autologinUser, autologinTimeout: boot.autologinTimeout }
    });
  } else {
    items.push({
      id: 'boot_autologin',
      status: 'ok',
      detail: `自动登录配置正常（autologin-user=${boot.autologinUser}, timeout=${boot.autologinTimeout}）`
    });
  }

  if (boot.startScript !== 'OK') {
    items.push({
      id: 'boot_autostart',
      status: 'warn',
      detail: '缺少 ~/robot_ros_application/scripts/start.sh：官方说明节点由该脚本开机启动（《教员手册》p.59）'
    });
  } else if ((boot.roscoreProcs || 0) === 0 && probe.rosMaster !== 'OK') {
    items.push({
      id: 'boot_autostart',
      status: 'fail',
      detail:
        'start.sh 存在但没有 roscore/roslaunch 进程，ROS Master 不可访问；官方处理方式是人工执行 start.sh（禁止自动重启）',
      evidence: { roscoreProcs: boot.roscoreProcs, startScript: boot.startScript }
    });
  } else {
    items.push({
      id: 'boot_autostart',
      status: 'ok',
      detail: `开机自启脚本存在，roscore/roslaunch 进程 ${boot.roscoreProcs || 0} 个`
    });
  }

  if (probe.uptimeSeconds === null || probe.uptimeSeconds === undefined) {
    items.push({ id: 'boot_window', status: 'unknown', detail: '无法读取开机运行时长' });
  } else if (probe.uptimeSeconds < BOOT_GRACE_SECONDS) {
    items.push({
      id: 'boot_window',
      status: 'warn',
      detail:
        `开机仅 ${probe.uptimeSeconds} s；官方说明上电约 40 s 后舵机加锁并恢复站立姿态，节点仍在启动中，` +
        '此刻的节点/话题缺失不能直接判故障',
      evidence: { uptimeSeconds: probe.uptimeSeconds }
    });
  } else {
    items.push({ id: 'boot_window', status: 'ok', detail: `开机运行 ${probe.uptimeSeconds} s，基线判定有效` });
  }

  const zp = probe.zeroPoint || {};
  if (zp.officialOffset === 'OK' && (zp.officialOffsetLines || 0) > 0) {
    items.push({
      id: 'zero_point_backup',
      status: 'ok',
      detail: `零点参数文件存在（~/.lejuconfig/offset.yaml，${zp.officialOffsetLines} 行）`,
      evidence: { stairOffset: zp.stairOffset }
    });
  } else if (zp.officialOffset === 'OK') {
    items.push({
      id: 'zero_point_backup',
      status: 'warn',
      detail: '~/.lejuconfig/offset.yaml 存在但为空：官方要求镜像刷新前先备份零点（《查零点步骤》p.1）'
    });
  } else {
    items.push({
      id: 'zero_point_backup',
      status: 'warn',
      detail:
        '找不到 ~/.lejuconfig/offset.yaml：零点备份缺失，镜像刷新后无法恢复零点（《查零点步骤》p.1）',
      evidence: { stairOffset: zp.stairOffset }
    });
  }

  items.push({
    id: 'realsense_usb',
    status: probe.usb && probe.usb.realsense === 'OK' ? 'ok' : 'warn',
    detail:
      probe.usb && probe.usb.realsense === 'OK'
        ? 'lsusb 看到 RealSense（官方规格：Intel RealSense D435）'
        : 'lsusb 未看到 RealSense：检查 USB3 线缆与供电（《使用入门》p.6）'
  });

  if (probe.chinLaunch === 'OK') {
    items.push({ id: 'chin_launch_path', status: 'ok', detail: '下巴相机 launch 文件存在（白名单修复可用）' });
  } else {
    items.push({
      id: 'chin_launch_path',
      status: 'warn',
      detail: '官方下巴相机 launch 文件不存在，自动修复动作无法执行，需人工核对路径'
    });
  }

  const topics = probe.topics || {};
  const footTopics = topics.footPressure || [];
  items.push({
    id: 'official_check_coverage',
    status: footTopics.length ? 'ok' : 'unknown',
    detail: footTopics.length
      ? `官方 check 的脚底压感项有可读 topic：${footTopics.join(', ')}，可纳入自动检测`
      : '官方 check 程序的脚底压感项没有可读 topic：需人工在 VNC 终端跑 check 逐项确认（《自检手册》p.1；《教员手册》p.24）',
    evidence: {
      footTopics,
      sensorHubTopicCount: (topics.sensorHub || []).length,
      bodyhubServices: probe.bodyhubServices || 0
    }
  });

  const rates = probe.rates || {};
  const micRate = rates.micWakeup;
  if (micRate === null || micRate === undefined) {
    items.push({
      id: 'mic_array',
      status: 'unknown',
      detail: '麦克风阵列 /micarrays/wakeup 短窗口无数据（官方说明为唤醒事件式发布，6 麦克风阵列）'
    });
  } else {
    items.push({ id: 'mic_array', status: 'ok', detail: `麦克风阵列 /micarrays/wakeup：${micRate.toFixed(1)} Hz` });
  }

  const masterUnreachable = (probe.logs && probe.logs.masterUnreachableLogs) || 0;
  if (masterUnreachable > 0) {
    items.push({
      id: 'master_unreachable_logs',
      status: 'warn',
      detail:
        `日志中出现 "Unable to communicate with master" ${masterUnreachable} 次；` +
        '官方处理：人工执行 ~/robot_ros_application/scripts/start.sh（《教员手册》p.60）',
      evidence: { count: masterUnreachable }
    });
  } else {
    items.push({ id: 'master_unreachable_logs', status: 'ok', detail: '日志中未见 master 不可达报错' });
  }

  return items;
}

const STATE_LEVEL = {
  init: 'warn',
  preReady: 'ok',
  ready: 'warn',
  running: 'warn',
  pause: 'ok',
  stoping: 'warn',
  error: 'fail',
  directOperate: 'warn',
  walking: 'warn'
};

function add(checks, checkId, status, detail, evidence) {
  const item = { id: checkId, status, detail };
  if (evidence !== undefined) item.evidence = evidence;
  checks.push(item);
}

function rateCheck(checks, checkId, rate, okMin, label) {
  if (rate === null || rate === undefined) {
    add(checks, checkId, 'unknown', `${label}：无数据`);
  } else if (rate >= okMin) {
    add(checks, checkId, 'ok', `${label}：${rate.toFixed(1)} Hz`);
  } else {
    add(checks, checkId, 'warn', `${label}：仅 ${rate.toFixed(1)} Hz`);
  }
}

function evaluate(probe) {
  const checks = [];
  const nodes = probe.nodes || [];

  add(checks, 'ssh',
    probe.sshOk ? 'ok' : 'fail',
    probe.sshOk ? 'SSH 连接正常' : 'SSH 连接失败',
    { exit_code: probe.sshExitCode });

  // 官方基线对照：机型/版本/代码新鲜度/开机自启/零点备份/相机与麦克风硬件
  for (const item of officialBaselineChecks(probe)) checks.push(item);

  const disk = probe.diskUsedPct;
  if (disk === null) add(checks, 'disk', 'unknown', '无法读取根分区使用率');
  else if (disk >= 95) add(checks, 'disk', 'fail', `根分区使用率 ${disk}%`);
  else if (disk >= 85) add(checks, 'disk', 'warn', `根分区使用率 ${disk}%`);
  else add(checks, 'disk', 'ok', `根分区使用率 ${disk}%`);

  if (probe.rosMaster === 'OK') {
    add(checks, 'ros_master', 'ok', `ROS Master 可访问，节点 ${nodes.length} 个`);
  } else {
    add(checks, 'ros_master', 'fail', 'ROS Master 不可访问');
  }

  const missingNodes = EXPECTED_NODES.filter((n) => !nodes.includes(n));
  const justBooted =
    probe.uptimeSeconds !== null && probe.uptimeSeconds !== undefined && probe.uptimeSeconds < BOOT_GRACE_SECONDS;
  if (!probe.sshOk || probe.rosMaster !== 'OK') {
    add(checks, 'expected_nodes', 'unknown', 'ROS 图不可用，跳过节点差异检查');
  } else if (missingNodes.length && justBooted) {
    add(checks, 'expected_nodes', 'warn',
      `缺少期望节点：${missingNodes.join(', ')}；开机不足 ${BOOT_GRACE_SECONDS} s，官方说明上电约 40 s 后节点才启动，暂不判故障`,
      { missing: missingNodes, uptimeSeconds: probe.uptimeSeconds });
  } else if (missingNodes.length) {
    add(checks, 'expected_nodes', 'fail',
      '缺少期望节点：' + missingNodes.join(', '), { missing: missingNodes });
  } else {
    add(checks, 'expected_nodes', 'ok', '期望节点全部在线');
  }

  add(checks, 'bodyhub_state',
    STATE_LEVEL[probe.bodyhubState] || 'unknown',
    `BodyHub 状态机：${probe.bodyhubState}`,
    { state: probe.bodyhubState });

  if (probe.masterId === null || probe.masterId === undefined) {
    add(checks, 'bodyhub_owner', 'unknown', '无法读取控制者 ID');
  } else if (probe.masterId === 0) {
    add(checks, 'bodyhub_owner', 'ok', '当前无人占用 BodyHub');
  } else {
    add(checks, 'bodyhub_owner', 'warn',
      `BodyHub 被节点 ${probe.masterId} 占用，禁止抢占`, { master_id: probe.masterId });
  }

  if (probe.poseQueue == null || probe.jointQueue == null) {
    add(checks, 'bodyhub_queues', 'unknown', '无法读取指令队列');
  } else if (probe.poseQueue === 0 && probe.jointQueue === 0) {
    add(checks, 'bodyhub_queues', 'ok', '姿势/关节队列均为 0');
  } else {
    add(checks, 'bodyhub_queues', 'warn',
      `指令队列未清空：pose=${probe.poseQueue}, joint=${probe.jointQueue}`,
      { pose: probe.poseQueue, joint: probe.jointQueue });
  }

  if (probe.jointCount === 22) {
    add(checks, 'joint_cache', 'ok', 'GetJointAngle 返回 22 个缓存角');
  } else if (probe.jointCount > 0) {
    add(checks, 'joint_cache', 'warn',
      `GetJointAngle 只返回 ${probe.jointCount} 个值`, { count: probe.jointCount });
  } else {
    add(checks, 'joint_cache', 'fail', 'GetJointAngle 无数据');
  }

  if (!probe.servoScanRaw) {
    add(checks, 'servo_scan', 'unknown', '未执行舵机总线扫描');
  } else if (String(probe.servoScanRaw).startsWith('SKIPPED')) {
    add(checks, 'servo_scan', 'unknown', probe.servoScanRaw);
  } else if (probe.servoScanIds.length) {
    const missingIds = SERVO_IDS.filter((n) => !probe.servoScanIds.includes(n));
    if (missingIds.length) {
      add(checks, 'servo_scan', 'fail',
        '总线缺少舵机 ID：' + missingIds.join(', '),
        { found: probe.servoScanIds, missing: missingIds });
    } else {
      add(checks, 'servo_scan', 'ok', '总线扫描到 1–22 全部舵机');
    }
  } else {
    add(checks, 'servo_scan', 'fail', '舵机总线扫描无返回');
  }

  if (!probe.temperatures.length) {
    add(checks, 'servo_temperature', 'unknown', '未读取到舵机温度');
  } else {
    const present = probe.temperatures.filter((t) => t > 0);
    const peak = present.length ? Math.max(...present) : 0;
    const zeroCount = probe.temperatures.filter((t) => t === 0).length;
    if (peak >= 70) {
      add(checks, 'servo_temperature', 'fail',
        `舵机最高温度 ${peak}°C，超过 70°C`,
        { peak, zero_ids: probe.tempZeroIds });
    } else if (zeroCount) {
      add(checks, 'servo_temperature', 'warn',
        `最高 ${peak}°C；${zeroCount} 个 ID 无温度读数（0 不等于 0°C）`,
        { peak, zero_ids: probe.tempZeroIds });
    } else {
      add(checks, 'servo_temperature', 'ok', `最高 ${peak}°C`);
    }
  }

  if (probe.realsenseNode !== 'OK') {
    add(checks, 'camera_color', 'fail', 'RealSense 节点不可访问');
  } else {
    rateCheck(checks, 'camera_color', probe.rates.cameraColor, 5, 'RealSense 彩色图');
  }

  if (probe.rates.chinCamera === null) {
    if (probe.chinCameraNode !== 'OK') {
      add(checks, 'camera_chin', 'fail',
        '下巴相机无数据且节点不可访问；/dev/usb_cam 存在时是安全重启候选');
    } else if (probe.usbCam !== 'OK') {
      add(checks, 'camera_chin', 'fail', '下巴相机设备 /dev/usb_cam 不存在');
    } else {
      add(checks, 'camera_chin', 'warn', '下巴相机节点在线但无数据');
    }
  } else {
    rateCheck(checks, 'camera_chin', probe.rates.chinCamera, 5, '下巴相机');
  }

  rateCheck(checks, 'battery_topic', probe.rates.battery, 0.5, '电池话题');

  add(checks, 'usb_servo_device',
    probe.usbServo === 'OK' ? 'ok' : 'fail',
    probe.usbServo === 'OK' ? '/dev/usb_servo 存在' : '/dev/usb_servo 不存在');

  add(checks, 'usb_cam_device',
    probe.usbCam === 'OK' ? 'ok' : 'warn',
    probe.usbCam === 'OK' ? '/dev/usb_cam 存在' : '/dev/usb_cam 不存在');

  const voltage = probe.battery.voltage;
  if (voltage === null) {
    add(checks, 'battery_voltage', 'unknown', '无法读取电池电压');
  } else if (voltage < 10.8) {
    add(checks, 'battery_voltage', 'fail', `电池电压 ${voltage.toFixed(1)} V，偏低`);
  } else if (voltage < 11.5) {
    add(checks, 'battery_voltage', 'warn', `电池电压 ${voltage.toFixed(1)} V`);
  } else {
    add(checks, 'battery_voltage', 'ok', `电池电压 ${voltage.toFixed(1)} V`);
  }

  if (probe.logs.dxlBulkReadErrors > 0) {
    add(checks, 'servo_bus_errors', 'warn',
      `rosout 中 dxlBulkRead 错误 ${probe.logs.dxlBulkReadErrors} 次（需看是否持续增长）`,
      { count: probe.logs.dxlBulkReadErrors });
  } else {
    add(checks, 'servo_bus_errors', 'ok', '未发现 dxlBulkRead 错误');
  }

  if (probe.logs.deadProcesses > 0) {
    add(checks, 'dead_processes', 'warn',
      `roslaunch 记录了 ${probe.logs.deadProcesses} 个进程退出`,
      { names: probe.logs.deadProcessNames });
  } else {
    add(checks, 'dead_processes', 'ok', 'roslaunch 未记录进程退出');
  }

  if (probe.ntpSynced === 'yes') add(checks, 'time_sync', 'ok', 'NTP 已同步');
  else if (probe.ntpSynced === 'no') add(checks, 'time_sync', 'warn', 'NTP 未同步');
  else add(checks, 'time_sync', 'unknown', '无法确认 NTP 状态');

  add(checks, 'chin_camera_node',
    probe.chinCameraNode === 'OK' ? 'ok' : 'warn',
    probe.chinCameraNode === 'OK' ? '/chin_camera 节点可访问' : '/chin_camera 节点不可访问');

  add(checks, 'realsense_node',
    probe.realsenseNode === 'OK' ? 'ok' : 'fail',
    probe.realsenseNode === 'OK'
      ? '/camera/realsense2_camera 可访问'
      : '/camera/realsense2_camera 不可访问');

  if (probe.rates.imuTorso === null) {
    add(checks, 'imu_torso', 'unknown', 'IMU /imu/Torso：无数据（可能事件式或未接入）');
  } else {
    add(checks, 'imu_torso', 'ok', `IMU /imu/Torso：${probe.rates.imuTorso.toFixed(1)} Hz`);
  }

  if (probe.rates.sensorTemperature === null) {
    add(checks, 'sensor_hub_temperature', 'unknown', 'SensorHub 温度：无数据');
  } else {
    add(checks, 'sensor_hub_temperature', 'ok',
      `SensorHub 温度：${probe.rates.sensorTemperature.toFixed(1)} Hz`);
  }

  const summary = { ok: 0, warn: 0, fail: 0, unknown: 0 };
  for (const c of checks) summary[c.status] += 1;
  return { checks, summary };
}

async function run(ctx, { probe } = {}) {
  if (!probe) throw new Error('selfcheck 需要 probe（先跑 env-probe）');
  const result = evaluate(probe);
  ctx.log(
    `[selfcheck] ok=${result.summary.ok} warn=${result.summary.warn} ` +
    `fail=${result.summary.fail} unknown=${result.summary.unknown}`
  );
  return {
    state: { checks: result.checks, summary: result.summary },
    checks: result.checks,
    summary: result.summary
  };
}

module.exports = { id, title, description, inputs, run, evaluate, EXPECTED_NODES };
