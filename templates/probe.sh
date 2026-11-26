#!/usr/bin/env bash
# Remote-only, read-only Roban probe.
# Executed by env-probe.js via: ssh <robot> 'bash -s' < script
# SCAN=1 enables ScanServo (only runs when BodyHub is preReady).

SCAN="${SCAN:-0}"

export ROS_MASTER_URI="${ROS_MASTER_URI:-http://localhost:11311}"

# Roban 1.0 = Ubuntu 16.04/ROS Kinetic，Roban 2.0 = Ubuntu 20.04（《版本查询手册》p.2）。
# 只 source kinetic 会让 2.0 机型误判为 "ROS Master 不可访问"，所以按实际发行版回退。
for distro in kinetic noetic melodic; do
  if [ -f "/opt/ros/$distro/setup.bash" ]; then
    . "/opt/ros/$distro/setup.bash"
    break
  fi
done
if [ -f "$HOME/robot_ros_application/catkin_ws/devel/setup.bash" ]; then
  . "$HOME/robot_ros_application/catkin_ws/devel/setup.bash"
fi

echo "HOST=$(hostname 2>/dev/null)"
echo "TIME=$(date '+%F %T %z' 2>/dev/null)"
echo "UPTIME=$(uptime -p 2>/dev/null | tr ' ' '_')"
echo "UPTIME_SECONDS=$(awk '{print int($1)}' /proc/uptime 2>/dev/null)"
echo "NTP_SYNCED=$(timedatectl 2>/dev/null | awk -F': ' '/NTP synchronized/{print $2}')"
echo "DISK_USED_PCT=$(df -P / 2>/dev/null | awk 'NR==2{gsub("%","",$5); print $5}')"
echo "MEM_AVAIL_MB=$(free -m 2>/dev/null | awk '/^Mem:/{print $7}')"
echo "MEM_TOTAL_MB=$(free -m 2>/dev/null | awk '/^Mem:/{print $2}')"
echo "USB_SERVO=$([ -e /dev/usb_servo ] && echo OK || echo MISSING)"
echo "USB_CAM=$([ -e /dev/usb_cam ] && echo OK || echo MISSING)"
echo "VIDEO_NODE_COUNT=$(ls /dev/video* 2>/dev/null | wc -l | tr -d ' ')"

# ---- 机型与代码新鲜度（《Roban机器人版本查询手册》p.1-2；《教员手册》p.9-10） ----
echo "OS_RELEASE=$(lsb_release -d 2>/dev/null | sed 's/^Description:[[:space:]]*//' | tr '\n' ' ')"
echo "ROS_DISTRO=${ROS_DISTRO:-UNKNOWN}"
REPO_DIR="$HOME/robot_ros_application"
echo "REPO_DIR=$([ -d "$REPO_DIR" ] && echo OK || echo MISSING)"
REPO_DATE="$(cd "$REPO_DIR" 2>/dev/null && git log -1 --date=short --format=%cd 2>/dev/null)"
echo "REPO_COMMIT_DATE=${REPO_DATE:-NO_REPO}"
echo "REPO_COMMIT=$(cd "$REPO_DIR" 2>/dev/null && git log -1 --format=%h 2>/dev/null)"

# ---- 开机自启与自动登录（《开机无法自动进入系统》p.1；《教员手册》p.59-60） ----
LIGHTDM="/etc/lightdm/lightdm.conf"
echo "LIGHTDM_CONF=$([ -f "$LIGHTDM" ] && echo OK || echo MISSING)"
echo "AUTOLOGIN_USER=$(grep -E '^[[:space:]]*autologin-user=' "$LIGHTDM" 2>/dev/null | head -1 | cut -d= -f2 | tr -d '[:space:]')"
echo "AUTOLOGIN_TIMEOUT=$(grep -E '^[[:space:]]*autologin-user-timeout=' "$LIGHTDM" 2>/dev/null | head -1 | cut -d= -f2 | tr -d '[:space:]')"
echo "START_SCRIPT=$([ -f "$REPO_DIR/scripts/start.sh" ] && echo OK || echo MISSING)"
echo "ROSCORE_PROCS=$(pgrep -f 'roscore|roslaunch' 2>/dev/null | wc -l | tr -d ' ')"
echo "CHIN_LAUNCH=$([ -f "$REPO_DIR/catkin_ws/src/ros_actions_node/scripts/botec/chin_cam.launch" ] && echo OK || echo MISSING)"

# ---- 零点参数文件（《Roban查零点步骤》p.1；《教员手册》p.37） ----
OFFICIAL_OFFSET="$HOME/.lejuconfig/offset.yaml"
STAIR_OFFSET="$REPO_DIR/footstair/src/motion_interface/config/offset.yaml"
echo "OFFICIAL_OFFSET=$([ -f "$OFFICIAL_OFFSET" ] && echo OK || echo MISSING)"
echo "OFFICIAL_OFFSET_LINES=$(wc -l < "$OFFICIAL_OFFSET" 2>/dev/null | tr -d ' ')"
echo "STAIR_OFFSET=$([ -f "$STAIR_OFFSET" ] && echo OK || echo MISSING)"

# ---- 官方自检项覆盖扫描（《自检手册》p.1-2；《教员手册》p.24 脚底压感测试） ----
ALL_TOPICS="$(timeout 6 rostopic list 2>/dev/null)"
echo "TOPIC_COUNT=$(printf '%s\n' "$ALL_TOPICS" | grep -c . 2>/dev/null | tr -d ' ')"
echo "FOOT_PRESSURE_TOPICS=$(printf '%s\n' "$ALL_TOPICS" | grep -iE 'foot|pressure|sole|bump' | tr '\n' ',' | sed 's/,$//')"
echo "SENSORHUB_TOPICS=$(printf '%s\n' "$ALL_TOPICS" | grep -i 'SensorHub' | tr '\n' ',' | sed 's/,$//')"
echo "BODYHUB_SERVICES=$(timeout 6 rosservice list 2>/dev/null | grep -ic 'BodyHub' 2>/dev/null | tr -d ' ')"

# ---- USB 设备（官方规格：RealSense D435 + USB 下巴相机） ----
LSUSB="$(lsusb 2>/dev/null)"
echo "REALSENSE_USB=$(printf '%s' "$LSUSB" | grep -iq 'RealSense' && echo OK || echo MISSING)"
echo "USB_DEVICE_COUNT=$(printf '%s\n' "$LSUSB" | grep -c . 2>/dev/null | tr -d ' ')"

# ---- 官方自检程序：只静态读取，不执行（执行需交互，可能触发节点/运动） ----
CHECK_BIN="$(command -v check 2>/dev/null)"
echo "OFFICIAL_CHECK_PATH=${CHECK_BIN:-MISSING}"
if [ -n "$CHECK_BIN" ]; then
  echo "OFFICIAL_CHECK_SIZE=$(wc -c < "$CHECK_BIN" 2>/dev/null | tr -d ' ')"
  echo "OFFICIAL_CHECK_ITEMS=$(head -c 3000 "$CHECK_BIN" 2>/dev/null | grep -oiE '[A-Za-z_]{3,20}_(test|check|status)' | head -20 | tr '\n' ',' | sed 's/,$//')"
fi

NODES="$(timeout 6 rosnode list 2>/dev/null)"
if [ -n "$NODES" ]; then
  echo "ROS_MASTER=OK"
  echo "NODE_COUNT=$(printf '%s\n' "$NODES" | grep -c .)"
  echo "NODES=$(printf '%s\n' "$NODES" | tr '\n' ',' | sed 's/,$//')"
else
  echo "ROS_MASTER=FAIL"
fi

if timeout 5 rosnode ping -c 1 /BodyHubNodeNew 2>&1 | grep -q 'xmlrpc reply'; then
  echo "BODYHUB_NODE=OK"
else
  echo "BODYHUB_NODE=UNREACHABLE"
fi

STATUS="$(timeout 5 rosservice call /MediumSize/BodyHub/GetStatus 'str: probe' 2>/dev/null)"
STATE="$(printf '%s\n' "$STATUS" | awk '/^data:/{gsub(/"/,"",$2); print $2; exit}')"
POSE_Q="$(printf '%s\n' "$STATUS" | awk '/poseQueueSize:/{print $2; exit}')"
JOINT_Q="$(printf '%s\n' "$STATUS" | awk '/jointQueueSize:/{print $2; exit}')"
echo "BODYHUB_STATE=${STATE:-UNKNOWN}"
echo "POSE_QUEUE=${POSE_Q:-UNKNOWN}"
echo "JOINT_QUEUE=${JOINT_Q:-UNKNOWN}"

MASTER_ID="$(timeout 5 rosservice call /MediumSize/BodyHub/GetMasterID 'str: probe' 2>/dev/null | awk '/^data:/{print $2; exit}')"
echo "MASTER_ID=${MASTER_ID:-UNKNOWN}"

SERVO_IDS='[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22]'
ANGLE_LINE="$(timeout 5 rosservice call /MediumSize/BodyHub/GetJointAngle "$SERVO_IDS" 22 2>/dev/null | head -1)"
echo "JOINT_ANGLES=${ANGLE_LINE:-NO_DATA}"
if [ -n "$ANGLE_LINE" ]; then
  echo "JOINT_COUNT=$(printf '%s' "$ANGLE_LINE" | grep -oE -- '-?[0-9]+(\.[0-9]+)?' | wc -l | tr -d ' ')"
else
  echo "JOINT_COUNT=0"
fi

TEMP_LINE="$(timeout 5 rosservice call /MediumSize/BodyHub/PresentTemperature 2>/dev/null | grep 'presentTemperature' | head -1)"
TEMP_VALUES="$(printf '%s' "$TEMP_LINE" | sed -n 's/.*\[\(.*\)\].*/\1/p')"
echo "TEMPERATURES=${TEMP_VALUES:-NO_DATA}"
if [ -n "$TEMP_VALUES" ]; then
  echo "TEMP_ZERO_COUNT=$(printf '%s' "$TEMP_VALUES" | tr ',' '\n' | awk '{gsub(/ /,"")} $1=="0"{n++} END{print n+0}')"
  echo "TEMP_ZERO_IDS=$(printf '%s' "$TEMP_VALUES" | tr ',' '\n' | awk '{gsub(/ /,"")} $1=="0"{ids=ids (ids?",":"") NR} END{print ids}')"
fi

if [ "$SCAN" = "1" ]; then
  if [ "$STATE" = "preReady" ]; then
    SCAN_LINE="$(timeout 15 rosservice call /MediumSize/BodyHub/ScanServo torso 2>/dev/null | head -1)"
    echo "SERVO_SCAN=${SCAN_LINE:-NO_DATA}"
  else
    echo "SERVO_SCAN=SKIPPED_STATE_${STATE:-UNKNOWN}"
  fi
fi

for topic in /camera/color/image_raw /chin_camera/image /MediumSize/SensorHub/BatteryState /imu/Torso /MediumSize/SensorHub/Temperature /micarrays/wakeup /MediumSize/BodyHub/Status; do
  RATE="$(timeout 5 rostopic hz "$topic" 2>/dev/null | awk '/average rate/{rate=$3; found=1} END{if(found) print rate; else print "NO_DATA"}')"
  KEY="$(printf '%s' "$topic" | tr '/.' '__')"
  echo "RATE${KEY}=${RATE}"
done

BATTERY_RAW="$(timeout 4 rostopic echo -n1 /MediumSize/SensorHub/BatteryState 2>/dev/null)"
echo "BATTERY_VOLTAGE=$(printf '%s\n' "$BATTERY_RAW" | awk '/^voltage:/{print $2; exit}')"
echo "BATTERY_PERCENTAGE=$(printf '%s\n' "$BATTERY_RAW" | awk '/^percentage:/{print $2; exit}')"
echo "BATTERY_PRESENT=$(printf '%s\n' "$BATTERY_RAW" | awk '/^present:/{print $2; exit}')"

if timeout 5 rosnode ping -c 1 /chin_camera 2>&1 | grep -q 'xmlrpc reply'; then
  echo "CHIN_CAMERA_NODE=OK"
else
  echo "CHIN_CAMERA_NODE=UNREACHABLE"
fi
if timeout 5 rosnode ping -c 1 /camera/realsense2_camera 2>&1 | grep -q 'xmlrpc reply'; then
  echo "REALSENSE_NODE=OK"
else
  echo "REALSENSE_NODE=UNREACHABLE"
fi

LOG_DIR="$(readlink -f "$HOME/.ros/log/latest" 2>/dev/null || echo "$HOME/.ros/log/latest")"
echo "DXL_BULK_READ_ERRORS=$(grep -h 'dxlBulkRead error' "$LOG_DIR/rosout.log" 2>/dev/null | wc -l | tr -d ' ')"
echo "TIMER_TIMEOUTS=$(grep -h 'timerThread() timeout' "$LOG_DIR/rosout.log" 2>/dev/null | wc -l | tr -d ' ')"
echo "ROSLOG_ERRORS=$(grep -h '\[ERROR\]' "$LOG_DIR/rosout.log" 2>/dev/null | wc -l | tr -d ' ')"
echo "MASTER_UNREACHABLE_LOGS=$(grep -h 'Unable to communicate with master' "$LOG_DIR"/roslaunch-*.log "$LOG_DIR"/rosout.log 2>/dev/null | wc -l | tr -d ' ')"
echo "DEAD_PROCESSES=$(grep -h 'process has died' "$LOG_DIR"/roslaunch-*.log 2>/dev/null | wc -l | tr -d ' ')"
echo "DEAD_PROCESS_NAMES=$(grep -h 'process has died' "$LOG_DIR"/roslaunch-*.log 2>/dev/null | sed -n 's/.*\[\([^]]*\)\] process has died.*/\1/p' | tail -5 | tr '\n' ',' | sed 's/,$//')"
