'use strict';
/**
 * joint-positions —— 刷新并读取 22 个关节的实测角度。
 *
 * 背景：GetJointAngle 返回 ServoStore.angle 缓存；BodyHub 只在进入 preReady 时
 * 调用 ReadJointValue() 刷新。手动转动关节后，必须先做一次
 * StateJump setStatus -> reset 的状态机往返，才能让缓存反映实测位置。
 *
 * 这是一个“控制读”：不运动、不改扭矩，但会短暂占用 BodyHub 状态机。
 * 必须由用户逐次批准（controlApproved=true），并在脚本退出时确保 reset。
 */

const sshRun = require('./ssh-run.js');
const safety = require('./safety.js');

const id = 'joint-positions';
const title = '刷新并读取关节实测角度';
const description = '短暂占用 BodyHub 状态机触发实测位置刷新，读取 22 个关节角；不运动';
const inputs = {
  controlApproved: 'boolean，用户是否批准这次控制读',
  timeoutMs: 'number，默认 60000'
};

const SERVO_IDS = '[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22]';

const REFRESH_SCRIPT = `
export ROS_MASTER_URI="\${ROS_MASTER_URI:-http://localhost:11311}"
if [ -f /opt/ros/kinetic/setup.bash ]; then . /opt/ros/kinetic/setup.bash; fi
if [ -f "$HOME/robot_ros_application/catkin_ws/devel/setup.bash" ]; then . "$HOME/robot_ros_application/catkin_ws/devel/setup.bash"; fi

SERVO_IDS='${SERVO_IDS}'
STATE="$(timeout 5 rosservice call /MediumSize/BodyHub/GetStatus 'str: joint-read' 2>/dev/null | awk '/^data:/{gsub(/"/,"",$2); print $2; exit}')"
MASTER="$(timeout 5 rosservice call /MediumSize/BodyHub/GetMasterID 'str: joint-read' 2>/dev/null | awk '/^data:/{print $2; exit}')"
echo "BEFORE_STATE=$STATE"
echo "BEFORE_MASTER=$MASTER"

if [ "$STATE" != "preReady" ] || [ "$MASTER" != "0" ]; then
  echo "REFRESH_STATUS=aborted_precondition"
  exit 5
fi

trap 'timeout 5 rosservice call /MediumSize/BodyHub/StateJump 99 reset >/dev/null 2>&1' EXIT

SET_RESULT="$(timeout 5 rosservice call /MediumSize/BodyHub/StateJump 99 setStatus 2>&1)"
echo "SET_RESULT=$(printf '%s' "$SET_RESULT" | tr '\\n' ' ')"
sleep 0.3
RESET_RESULT="$(timeout 5 rosservice call /MediumSize/BodyHub/StateJump 99 reset 2>&1)"
if printf '%s' "$RESET_RESULT" | grep -q '21'; then trap - EXIT; fi
echo "RESET_RESULT=$(printf '%s' "$RESET_RESULT" | tr '\\n' ' ')"
sleep 0.5

ANGLES="$(timeout 5 rosservice call /MediumSize/BodyHub/GetJointAngle "$SERVO_IDS" 22 2>/dev/null | head -1)"
AFTER_MASTER="$(timeout 5 rosservice call /MediumSize/BodyHub/GetMasterID 'str: joint-read' 2>/dev/null | awk '/^data:/{print $2; exit}')"
AFTER_STATE="$(timeout 5 rosservice call /MediumSize/BodyHub/GetStatus 'str: joint-read' 2>/dev/null | awk '/^data:/{gsub(/"/,"",$2); print $2; exit}')"

echo "ANGLES=$ANGLES"
echo "AFTER_MASTER=$AFTER_MASTER"
echo "AFTER_STATE=$AFTER_STATE"
if [ "$AFTER_MASTER" = "0" ] && [ "$AFTER_STATE" = "preReady" ]; then
  echo "REFRESH_STATUS=ok"
else
  echo "REFRESH_STATUS=release_failed"
  exit 6
fi
`;

function parseNumbers(text) {
  return (String(text || '').match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
}

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

async function refreshAndRead(ctx, { controlApproved = false, timeoutMs = 60000 } = {}) {
  const gate = safety.reviewActions(['refresh-joint-positions'], {
    ctx,
    execute: true,
    controlApproved: controlApproved === true || ctx.controlApproved === true
  });
  if (!gate.approved) {
    const reason = gate.violations.map((item) => item.reason).join('；');
    ctx.log(`[joint-positions][safety-block] ${reason}`);
    return { status: 'blocked', reason, safety: gate };
  }

  const res = await sshRun.run(ctx, {
    command: 'bash -s',
    input: REFRESH_SCRIPT,
    timeoutMs
  });
  const raw = parseKv(res.stdout + '\n' + res.stderr);
  const values = parseNumbers(raw.ANGLES).slice(0, 22);
  const status = raw.REFRESH_STATUS || (res.code === 0 ? 'ok' : 'failed');

  const result = {
    status,
    values,
    count: values.length,
    beforeState: raw.BEFORE_STATE || 'UNKNOWN',
    beforeMaster: raw.BEFORE_MASTER,
    afterState: raw.AFTER_STATE || 'UNKNOWN',
    afterMaster: raw.AFTER_MASTER,
    setResult: raw.SET_RESULT || '',
    resetResult: raw.RESET_RESULT || '',
    safety: gate,
    exitCode: res.code
  };

  ctx.log(
    `[joint-positions] status=${status} count=${values.length} ` +
    `state=${result.afterState} master=${result.afterMaster}`
  );
  return result;
}

async function run(ctx, input = {}) {
  const result = await refreshAndRead(ctx, input);
  return { state: { jointPositions: result }, ...result };
}

module.exports = {
  id, title, description, inputs, run,
  refreshAndRead, parseKv, parseNumbers, REFRESH_SCRIPT
};
