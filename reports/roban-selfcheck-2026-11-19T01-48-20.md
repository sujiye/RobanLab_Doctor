# Roban 自检报告

- 机器人：lemon-NUC8i3BEH ()
- 采集时间：2026-11-19 09:47:42 +0800
- BodyHub：preReady，masterID=0
- 总览：OK 15 / WARN 4 / FAIL 2 / UNKNOWN 2

## 检查项

| 状态 | 检查 | 说明 |
|---|---|---|
| OK | ssh | SSH 连接正常 |
| OK | disk | 根分区使用率 37% |
| OK | ros_master | ROS Master 可访问，节点 21 个 |
| FAIL | expected_nodes | 缺少期望节点：/chin_camera |
| OK | bodyhub_state | BodyHub 状态机：preReady |
| OK | bodyhub_owner | 当前无人占用 BodyHub |
| OK | bodyhub_queues | 姿势/关节队列均为 0 |
| OK | joint_cache | GetJointAngle 返回 22 个缓存角 |
| OK | servo_scan | 总线扫描到 1–22 全部舵机 |
| WARN | servo_temperature | 最高 41°C；5 个 ID 无温度读数（0 不等于 0°C） |
| OK | camera_color | RealSense 彩色图：16.6 Hz |
| FAIL | camera_chin | 下巴相机无数据且节点不可访问；/dev/usb_cam 存在时是安全重启候选 |
| OK | battery_topic | 电池话题：20.0 Hz |
| OK | usb_servo_device | /dev/usb_servo 存在 |
| OK | usb_cam_device | /dev/usb_cam 存在 |
| OK | battery_voltage | 电池电压 12.2 V |
| WARN | servo_bus_errors | rosout 中 dxlBulkRead 错误 14 次（需看是否持续增长） |
| WARN | dead_processes | roslaunch 记录了 1 个进程退出 |
| OK | time_sync | NTP 已同步 |
| WARN | chin_camera_node | /chin_camera 节点不可访问 |
| OK | realsense_node | /camera/realsense2_camera 可访问 |
| UNKNOWN | imu_torso | IMU /imu/Torso：无数据（可能事件式或未接入） |
| UNKNOWN | sensor_hub_temperature | SensorHub 温度：无数据 |

## 诊断

### 发现

- [FAIL] 缺少期望节点：/chin_camera（software，置信度 high）
- [FAIL] 下巴相机无数据且节点不可访问；/dev/usb_cam 存在时是安全重启候选（software，置信度 high）
- [WARN] 最高 41°C；5 个 ID 无温度读数（0 不等于 0°C）（hardware，置信度 medium）
- [WARN] rosout 中 dxlBulkRead 错误 14 次（需看是否持续增长）（hardware，置信度 medium）
- [WARN] roslaunch 记录了 1 个进程退出（software，置信度 medium）
- [WARN] /chin_camera 节点不可访问（software，置信度 medium）
- [UNKNOWN] IMU /imu/Torso：无数据（可能事件式或未接入）（sensor，置信度 low）
- [UNKNOWN] SensorHub 温度：无数据（sensor，置信度 low）

### 候选原因

- **chin-camera-startup-order**：下巴相机节点可能在 /dev/usb_cam 建立之前启动，随后退出；设备节点现在存在，重启非运动相机节点可以验证这个假设。（置信度 high）
  - 证据：camera_chin=fail；chin_camera_node=warn；usb_cam=OK；dead_processes=1
- **servo-bus-intermittent**：总线仍能扫描到全部舵机，读错误更像间歇性通信问题，优先检查供电、线缆、接头和总线负载。（置信度 medium）
  - 证据：dxl_bulk_read_errors=14；servo_scan=ok
- **servo-temperature-zero-readings**：部分舵机 ID 返回 0 温度，这是“无读数”，不是 0°C；需要结合舵机型号和是否安装判断。（置信度 medium）
  - 证据：zero_ids=14,15,19,21,22
- **imu_torso-no-data**：短窗口内没有数据，可能是低频/事件式发布，也可能是传感器未接入；不能直接判故障。（置信度 low）
  - 证据：imu_torso=unknown
- **sensor_hub_temperature-no-data**：短窗口内没有数据，可能是低频/事件式发布，也可能是传感器未接入；不能直接判故障。（置信度 low）
  - 证据：sensor_hub_temperature=unknown

### 修复候选

- **restart-chin-camera**（L2）：重启下巴相机节点；需确认=true
  - 前置条件：{"bodyhub_state":"preReady","master_id":0,"usb_cam":"OK"}
  - 复检：{"topic":"/chin_camera/image","min_hz":5,"min_seconds":5}

## 修复记录

- 动作：restart-chin-camera
- 状态：dry_run（dry-run，未执行）
- 修复前：{"bodyhub_state":"preReady","master_id":"0","usb_cam":"OK","chin_node":"UNREACHABLE","rate_hz":null}
- 修复后：{"node_started":false,"rate_hz":null}

## 人工待办

- 检查舵机供电、USB/串口线缆、接头和总线负载；不要自动修改配置或更换舵机。
- 确认无温度读数的 ID 是否为本机未安装或型号不支持温度回读的舵机。

## 数据来源说明

- `GetJointAngle` 返回软件缓存角，不是电机实测位置。
- 温度 0 表示无读数，不是 0°C；电池用电压判断，不用 percentage。
- BodyHub 的 Status / ServoPositions / joint 话题是事件式发布，短窗口无消息不等于故障。
