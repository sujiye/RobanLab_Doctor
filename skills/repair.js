'use strict';
/**
 * repair —— 白名单安全修复。当前只允许重启下巴相机（非运动节点）。
 *
 * 默认 dry-run：只做前置检查并返回计划。
 * 只有 input.confirm === true 才会真正执行；执行后必须通过话题频率复检。
 *
 * 明确不做：StateJump、舵机上电/卸力、关节运动、修改 offset/零位、重启整套系统。
 */

const sshRun = require('./ssh-run.js');
const envProbe = require('./env-probe.js');
const safety = require('./safety.js');

const id = 'repair';
const title = '白名单安全修复（当前：重启下巴相机）';
const description = '默认 dry-run；confirm=true 才执行，并返回修复前后证据';
const inputs = {
  action: 'string，目前只支持 restart-chin-camera',
  confirm: 'boolean，默认 false；true 才真正执行'
};

const ACTIONS = {
  'restart-chin-camera': {
    title: '重启下巴相机节点',
    launchPath:
      '/home/lemon/robot_ros_application/catkin_ws/src/ros_actions_node/scripts/botec/chin_cam.launch',
    topic: '/chin_camera/image',
    minHz: 5
  }
};

const REMOTE_SCRIPT = `
LAUNCH="/home/lemon/robot_ros_application/catkin_ws/src/ros_actions_node/scripts/botec/chin_cam.launch"

if [ -f /opt/ros/kinetic/setup.bash ]; then
  . /opt/ros/kinetic/setup.bash
fi
if [ -f "$HOME/robot_ros_application/catkin_ws/devel/setup.bash" ]; then
  . "$HOME/robot_ros_application/catkin_ws/devel/setup.bash"
fi

STATE="$(timeout 5 rosservice call /MediumSize/BodyHub/GetStatus 'str: repair' 2>/dev/null | awk '/^data:/{gsub(/"/,"",$2); print $2; exit}')"
MASTER_ID="$(timeout 5 rosservice call /MediumSize/BodyHub/GetMasterID 'str: repair' 2>/dev/null | awk '/^data:/{print $2; exit}')"
if [ -e /dev/usb_cam ]; then USB_CAM=OK; else USB_CAM=MISSING; fi

if timeout 5 rosnode ping -c 1 /chin_camera 2>&1 | grep -q 'xmlrpc reply'; then
  CHIN_NODE=OK
else
  CHIN_NODE=UNREACHABLE
fi

BEFORE_RATE="$(timeout 5 rostopic hz /chin_camera/image 2>/dev/null | awk '/average rate/{rate=$3; found=1} END{if(found) print rate; else print "NO_DATA"}')"

echo "BODYHUB_STATE=$STATE"
echo "MASTER_ID=$MASTER_ID"
echo "USB_CAM=$USB_CAM"
echo "CHIN_NODE=$CHIN_NODE"
echo "BEFORE_RATE=$BEFORE_RATE"

if [ "$APPLY" != "1" ]; then
  echo "PLAN=roslaunch $LAUNCH"
  echo "REPAIR_STATUS=dry_run"
  exit 0
fi

case "$STATE" in
  walking|running|error)
    echo "REPAIR_STATUS=aborted_bodyhub_state"
    exit 5
    ;;
esac

if [ "$MASTER_ID" != "0" ]; then
  echo "REPAIR_STATUS=aborted_bodyhub_occupied"
  exit 5
fi

if [ "$USB_CAM" != "OK" ]; then
  echo "REPAIR_STATUS=aborted_no_usb_cam"
  exit 6
fi

if [ "$CHIN_NODE" = "OK" ] && [ "$BEFORE_RATE" != "NO_DATA" ] && awk -v r="$BEFORE_RATE" 'BEGIN{exit !(r+0>=5)}'; then
  echo "REPAIR_STATUS=noop_already_running"
  exit 0
fi

nohup setsid roslaunch "$LAUNCH" > /tmp/chin_cam_restart.log 2>&1 < /dev/null &
echo "LAUNCH_PID=$!"

STARTED=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if timeout 3 rosnode ping -c 1 /chin_camera 2>&1 | grep -q 'xmlrpc reply'; then
    STARTED=1
    break
  fi
  sleep 1
done
echo "NODE_STARTED=$STARTED"

sleep 2
AFTER_RATE="$(timeout 6 rostopic hz /chin_camera/image 2>/dev/null | awk '/average rate/{rate=$3; found=1} END{if(found) print rate; else print "NO_DATA"}')"
echo "AFTER_RATE=$AFTER_RATE"

if [ "$STARTED" = "1" ] && [ "$AFTER_RATE" != "NO_DATA" ] && awk -v r="$AFTER_RATE" 'BEGIN{exit !(r+0>=5)}'; then
  echo "REPAIR_STATUS=success"
  exit 0
fi

echo "REPAIR_STATUS=failed"
echo "LOG_TAIL_BEGIN"
tail -20 /tmp/chin_cam_restart.log 2>/dev/null
echo "LOG_TAIL_END"
exit 7
`;

function extractLogTail(stdout) {
  const begin = stdout.indexOf('LOG_TAIL_BEGIN');
  const end = stdout.indexOf('LOG_TAIL_END');
  if (begin === -1 || end === -1 || end <= begin) return '';
  return stdout.slice(begin + 'LOG_TAIL_BEGIN'.length, end).trim();
}

async function run(ctx, { action = 'restart-chin-camera', confirm = false } = {}) {
  const spec = ACTIONS[action];
  if (!spec) {
    return { status: 'skipped', reason: `未知动作：${action}` };
  }

  // 每次执行前重新读取 ATTENTION 并做动作审查。
  const gate = safety.reviewActions([action], {
    ctx,
    execute: confirm,
    motionApproved: ctx.motionApproved === true,
    stopPlan: ctx.stopPlan || ''
  });
  if (!gate.approved) {
    const reason = gate.violations.map((item) => item.reason).join('；');
    const blocked = {
      action,
      title: spec.title,
      status: 'blocked',
      dry_run: !confirm,
      safety: gate,
      reason
    };
    ctx.log(`[repair][safety-block] ${action}: ${reason}`);
    return { state: { repair: blocked }, ...blocked };
  }
  if (gate.motionActions.length) {
    ctx.log('[repair][safety-motion] ' + gate.stopInstructions);
  }

  const script = `APPLY=${confirm ? '1' : '0'}\n${REMOTE_SCRIPT}`;
  const res = await sshRun.run(ctx, {
    command: 'bash -s',
    input: script,
    timeoutMs: 120000
  });
  const kv = envProbe.parseKv(res.stdout + '\n' + res.stderr);
  const status = kv.REPAIR_STATUS || (res.code === 0 ? 'success' : 'failed');

  const result = {
    action,
    title: spec.title,
    status,
    dry_run: !confirm,
    plan: kv.PLAN || `roslaunch ${spec.launchPath}`,
    before: {
      bodyhub_state: kv.BODYHUB_STATE || 'UNKNOWN',
      master_id: kv.MASTER_ID == null ? null : Number(kv.MASTER_ID),
      usb_cam: kv.USB_CAM || 'MISSING',
      chin_node: kv.CHIN_NODE || 'UNREACHABLE',
      rate_hz: kv.BEFORE_RATE === 'NO_DATA' ? null : Number(kv.BEFORE_RATE)
    },
    after: {
      node_started: kv.NODE_STARTED === '1',
      rate_hz: kv.AFTER_RATE === 'NO_DATA' ? null : Number(kv.AFTER_RATE)
    },
    verification: {
      topic: spec.topic,
      min_hz: spec.minHz,
      passed: status === 'success'
    },
    log_tail: extractLogTail(res.stdout),
    exit_code: res.code,
    safety: gate
  };

  ctx.log(`[repair] ${action} -> ${status}${result.dry_run ? ' (dry-run)' : ''}`);
  return { state: { repair: result }, ...result };
}

module.exports = { id, title, description, inputs, run, ACTIONS };
