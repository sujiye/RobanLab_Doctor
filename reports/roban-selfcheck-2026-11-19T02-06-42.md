# Roban 自检报告

- 机器人：lemon-NUC8i3BEH (10.29.101.186)
- 采集时间：2026-11-19 10:06:02 +0800
- BodyHub：preReady，masterID=0
- 总览：OK 18 / WARN 3 / FAIL 0 / UNKNOWN 2

## 检查项

| 状态 | 检查 | 说明 |
|---|---|---|
| OK | ssh | SSH 连接正常 |
| OK | disk | 根分区使用率 37% |
| OK | ros_master | ROS Master 可访问，节点 22 个 |
| OK | expected_nodes | 期望节点全部在线 |
| OK | bodyhub_state | BodyHub 状态机：preReady |
| OK | bodyhub_owner | 当前无人占用 BodyHub |
| OK | bodyhub_queues | 姿势/关节队列均为 0 |
| OK | joint_cache | GetJointAngle 返回 22 个缓存角 |
| OK | servo_scan | 总线扫描到 1–22 全部舵机 |
| WARN | servo_temperature | 最高 45°C；5 个 ID 无温度读数（0 不等于 0°C） |
| OK | camera_color | RealSense 彩色图：16.6 Hz |
| OK | camera_chin | 下巴相机：10.5 Hz |
| OK | battery_topic | 电池话题：20.0 Hz |
| OK | usb_servo_device | /dev/usb_servo 存在 |
| OK | usb_cam_device | /dev/usb_cam 存在 |
| OK | battery_voltage | 电池电压 12.2 V |
| WARN | servo_bus_errors | rosout 中 dxlBulkRead 错误 21 次（需看是否持续增长） |
| WARN | dead_processes | roslaunch 记录了 1 个进程退出 |
| OK | time_sync | NTP 已同步 |
| OK | chin_camera_node | /chin_camera 节点可访问 |
| OK | realsense_node | /camera/realsense2_camera 可访问 |
| UNKNOWN | imu_torso | IMU /imu/Torso：无数据（可能事件式或未接入） |
| UNKNOWN | sensor_hub_temperature | SensorHub 温度：无数据 |

## 自动修复（知识库优先 + 并行）

### 故障单元与知识库检索

| 组件 | 严重度 | 检查项 | 知识库 | 匹配案例 | 计划来源 | 计划状态 |
|---|---|---|---|---|---|---|
| servo.temperature | WARN | servo_temperature | 0.90 | servo-temperature-zero-readings | kb-manual | manual |
| servo.bus | WARN | servo_bus_errors | 0.70 | servo-bus-intermittent-reads | kb-manual | manual |
| camera.chin | WARN | dead_processes | 未命中 | — | generated | ready |
| sensor.imu | UNKNOWN | imu_torso | 1.00 | sensor-imu-no-data | kb-manual | manual |
| sensor.sensorhub | UNKNOWN | sensor_hub_temperature | 0.95 | sensor-sensorhub-no-data | kb-manual | manual |

- 执行模式：dry_run；并发上限 3；实际最大并发 1；耗时 7240 ms
- 结果：成功 0 / 失败 0 / 阻止 0 / 人工 4 / dry-run 1

| 组件 | 状态 | 执行来源 | 知识库案例 | 动作（尝试） | 耗时 ms |
|---|---|---|---|---|---|
| servo.temperature | manual_required | kb-manual | — | — | 0 |
| servo.bus | manual_required | kb-manual | — | — | 0 |
| camera.chin | dry_run | generated | — | restart-chin-camera=dry_run | 7234 |
| sensor.imu | manual_required | kb-manual | — | — | 0 |
| sensor.sensorhub | manual_required | kb-manual | — | — | 0 |


## 诊断

### 发现

- [WARN] 最高 45°C；5 个 ID 无温度读数（0 不等于 0°C）（hardware，置信度 medium）
- [WARN] rosout 中 dxlBulkRead 错误 21 次（需看是否持续增长）（hardware，置信度 medium）
- [WARN] roslaunch 记录了 1 个进程退出（software，置信度 medium）
- [UNKNOWN] IMU /imu/Torso：无数据（可能事件式或未接入）（sensor，置信度 low）
- [UNKNOWN] SensorHub 温度：无数据（sensor，置信度 low）

### 候选原因

- **servo-bus-intermittent**：总线仍能扫描到全部舵机，读错误更像间歇性通信问题，优先检查供电、线缆、接头和总线负载。（置信度 medium）
  - 证据：dxl_bulk_read_errors=21；servo_scan=ok
- **servo-temperature-zero-readings**：部分舵机 ID 返回 0 温度，这是“无读数”，不是 0°C；需要结合舵机型号和是否安装判断。（置信度 medium）
  - 证据：zero_ids=14,15,19,21,22
- **imu_torso-no-data**：短窗口内没有数据，可能是低频/事件式发布，也可能是传感器未接入；不能直接判故障。（置信度 low）
  - 证据：imu_torso=unknown
- **sensor_hub_temperature-no-data**：短窗口内没有数据，可能是低频/事件式发布，也可能是传感器未接入；不能直接判故障。（置信度 low）
  - 证据：sensor_hub_temperature=unknown

## 人工待办

- 检查舵机供电、USB/串口线缆、接头和总线负载；不要自动修改配置或更换舵机。
- 确认无温度读数的 ID 是否为本机未安装或型号不支持温度回读的舵机。

## 数据来源说明

- `GetJointAngle` 返回软件缓存角，不是电机实测位置。
- 温度 0 表示无读数，不是 0°C；电池用电压判断，不用 percentage。
- BodyHub 的 Status / ServoPositions / joint 话题是事件式发布，短窗口无消息不等于故障。
