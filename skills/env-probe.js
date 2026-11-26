'use strict';
/**
 * env-probe —— 采集 Roban 的只读基线：主机、ROS 图、BodyHub、舵机、传感器、日志。
 *
 * 脚本本身在 templates/probe.sh，经 stdin 交给远端 bash 执行。
 * 不占用 BodyHub 状态机、不发布运动指令、不写舵机。
 */

const fsDefault = require('fs');
const path = require('path');
const sshRun = require('./ssh-run.js');

const id = 'env-probe';
const title = '机器人只读基线探测';
const description = '返回结构化 probe 对象：主机、ROS 节点、BodyHub、关节、温度、话题频率、日志';
const inputs = { scan: 'boolean，是否执行 ScanServo（仅 preReady 时生效），默认 true' };

function parseKv(text) {
  const raw = {};
  for (const line of String(text).split('\n')) {
    if (!line.includes('=')) continue;
    const i = line.indexOf('=');
    const key = line.slice(0, i).trim();
    if (/^[A-Z][A-Za-z0-9_]*$/.test(key)) raw[key] = line.slice(i + 1).trim();
  }
  return raw;
}

function asInt(value, fallback = null) {
  const n = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(n) ? n : fallback;
}

function asFloat(value, fallback = null) {
  const n = Number.parseFloat(String(value ?? '').trim());
  return Number.isFinite(n) ? n : fallback;
}

function numbers(text) {
  return (String(text || '').match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
}

function intList(text) {
  return (String(text || '').match(/-?\d+/g) || []).map(Number);
}

function parseRate(value) {
  if (!value || value === 'NO_DATA') return null;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

function parseRobotModel(osRelease) {
  const s = String(osRelease || '').toLowerCase();
  if (s.includes('16.04')) return 'Roban 1.0';
  if (s.includes('20.04')) return 'Roban 2.0';
  return 'UNKNOWN';
}

/** 官方判据：仓库时间早于 2023-11-29 需要更新代码（《版本查询手册》p.1）。 */
const CODE_CUTOVER = '2023-11-29';

function parseDate(value) {
  const m = String(value || '').match(/\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}

function buildProbe(raw) {
  const nodes = String(raw.NODES || '').split(',').filter(Boolean);
  return {
    raw,
    host: raw.HOST || '',
    time: raw.TIME || '',
    uptime: raw.UPTIME || '',
    uptimeSeconds: asInt(raw.UPTIME_SECONDS),
    ntpSynced: raw.NTP_SYNCED || '',
    diskUsedPct: asInt(raw.DISK_USED_PCT),
    memAvailMb: asInt(raw.MEM_AVAIL_MB),
    memTotalMb: asInt(raw.MEM_TOTAL_MB),
    usbServo: raw.USB_SERVO || 'MISSING',
    usbCam: raw.USB_CAM || 'MISSING',
    videoNodeCount: asInt(raw.VIDEO_NODE_COUNT, 0),
    rosMaster: raw.ROS_MASTER || 'FAIL',
    nodeCount: asInt(raw.NODE_COUNT, 0),
    nodes,
    // 机型/版本（《版本查询手册》p.1-2）
    osRelease: raw.OS_RELEASE || '',
    robotModel: parseRobotModel(raw.OS_RELEASE),
    rosDistro: raw.ROS_DISTRO || 'UNKNOWN',
    repo: {
      dir: raw.REPO_DIR || 'MISSING',
      commitDate: parseDate(raw.REPO_COMMIT_DATE),
      commit: raw.REPO_COMMIT || '',
      // 官方判据：仓库时间早于 2023-11-29 视为需要更新（《版本查询手册》p.1）
      outdated: (() => {
        const d = parseDate(raw.REPO_COMMIT_DATE);
        return d ? d < CODE_CUTOVER : null;
      })()
    },
    // 开机自启 / 自动登录（《开机无法自动进入系统》p.1；《教员手册》p.59-60）
    boot: {
      lightdm: raw.LIGHTDM_CONF || 'MISSING',
      autologinUser: raw.AUTOLOGIN_USER || '',
      autologinTimeout: raw.AUTOLOGIN_TIMEOUT || '',
      startScript: raw.START_SCRIPT || 'MISSING',
      roscoreProcs: asInt(raw.ROSCORE_PROCS, 0)
    },
    // 零点参数文件（《查零点步骤》p.1；《教员手册》p.37）
    zeroPoint: {
      officialOffset: raw.OFFICIAL_OFFSET || 'MISSING',
      officialOffsetLines: asInt(raw.OFFICIAL_OFFSET_LINES, 0),
      stairOffset: raw.STAIR_OFFSET || 'MISSING'
    },
    // 修复脚本可用性（白名单动作依赖该 launch 文件）
    chinLaunch: raw.CHIN_LAUNCH || 'MISSING',
    // 官方自检程序：静态识别，不执行
    officialCheck: {
      path: raw.OFFICIAL_CHECK_PATH || 'MISSING',
      size: asInt(raw.OFFICIAL_CHECK_SIZE, 0),
      items: (raw.OFFICIAL_CHECK_ITEMS || '').split(',').filter(Boolean)
    },
    usb: {
      realsense: raw.REALSENSE_USB || 'MISSING',
      deviceCount: asInt(raw.USB_DEVICE_COUNT, 0)
    },
    topics: {
      count: asInt(raw.TOPIC_COUNT, 0),
      all: (raw.TOPICS || '').split(',').filter(Boolean),
      footPressure: (raw.FOOT_PRESSURE_TOPICS || '').split(',').filter(Boolean),
      sensorHub: (raw.SENSORHUB_TOPICS || '').split(',').filter(Boolean)
    },
    services: (raw.SERVICES || '').split(',').filter(Boolean),
    bodyhubServices: asInt(raw.BODYHUB_SERVICES, 0),
    bodyhubNode: raw.BODYHUB_NODE || 'UNREACHABLE',
    bodyhubState: raw.BODYHUB_STATE || 'UNKNOWN',
    poseQueue: asInt(raw.POSE_QUEUE),
    jointQueue: asInt(raw.JOINT_QUEUE),
    masterId: asInt(raw.MASTER_ID),
    jointAngles: numbers(raw.JOINT_ANGLES),
    jointCount: asInt(raw.JOINT_COUNT, 0),
    temperatures: intList(raw.TEMPERATURES),
    tempZeroIds: intList(raw.TEMP_ZERO_IDS),
    servoScanIds: intList(raw.SERVO_SCAN),
    servoScanRaw: raw.SERVO_SCAN || '',
    rates: {
      cameraColor: parseRate(raw.RATE_camera_color_image_raw),
      chinCamera: parseRate(raw.RATE_chin_camera_image),
      battery: parseRate(raw.RATE_MediumSize_SensorHub_BatteryState),
      imuTorso: parseRate(raw.RATE_imu_Torso),
      sensorTemperature: parseRate(raw.RATE_MediumSize_SensorHub_Temperature),
      micWakeup: parseRate(raw.RATE_micarrays_wakeup),
      bodyhubStatus: parseRate(raw.RATE_MediumSize_BodyHub_Status)
    },
    battery: {
      voltage: asFloat(raw.BATTERY_VOLTAGE),
      percentage: asFloat(raw.BATTERY_PERCENTAGE),
      present: raw.BATTERY_PRESENT || ''
    },
    chinCameraNode: raw.CHIN_CAMERA_NODE || 'UNREACHABLE',
    realsenseNode: raw.REALSENSE_NODE || 'UNREACHABLE',
    logs: {
      dxlBulkReadErrors: asInt(raw.DXL_BULK_READ_ERRORS, 0),
      timerTimeouts: asInt(raw.TIMER_TIMEOUTS, 0),
      roslogErrors: asInt(raw.ROSLOG_ERRORS, 0),
      masterUnreachableLogs: asInt(raw.MASTER_UNREACHABLE_LOGS, 0),
      deadProcesses: asInt(raw.DEAD_PROCESSES, 0),
      deadProcessNames: raw.DEAD_PROCESS_NAMES || ''
    }
  };
}

async function run(ctx, { scan = true } = {}) {
  const fs = ctx.fs || fsDefault;
  const templatePath = path.join(__dirname, '..', 'templates', 'probe.sh');
  const template = fs.readFileSync(templatePath, 'utf8');
  const script = `SCAN=${scan ? '1' : '0'}\n${template}`;

  const res = await sshRun.run(ctx, {
    command: 'bash -s',
    input: script,
    timeoutMs: 180000
  });

  const raw = parseKv(res.stdout + '\n' + res.stderr);
  const probe = buildProbe(raw);
  probe.ip = (ctx.remote && ctx.remote.host) || probe.host;
  probe.sshOk = res.code === 0 && raw.ROS_MASTER !== undefined;
  probe.sshExitCode = res.code;
  probe.stderrTail = res.stderr.trim().split('\n').slice(-5);

  ctx.log(
    `[probe] ${probe.host || '?'} state=${probe.bodyhubState} ` +
    `nodes=${probe.nodeCount} chin=${probe.chinCameraNode}`
  );
  return { state: { probe }, probe };
}

module.exports = {
  id, title, description, inputs, run,
  parseKv, buildProbe
};
