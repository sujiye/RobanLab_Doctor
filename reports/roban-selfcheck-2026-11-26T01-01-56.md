# Roban 自检报告

- 机器人：lemon-NUC8i3BEH (10.29.101.186)
- 采集时间：2026-11-26 09:01:25 +0800
- BodyHub：preReady，masterID=0
- 总览：OK 19 / WARN 1 / FAIL 0 / UNKNOWN 3

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
| UNKNOWN | servo_temperature | 未读取到舵机温度 |
| OK | camera_color | RealSense 彩色图：16.6 Hz |
| OK | camera_chin | 下巴相机：10.4 Hz |
| OK | battery_topic | 电池话题：20.0 Hz |
| OK | usb_servo_device | /dev/usb_servo 存在 |
| OK | usb_cam_device | /dev/usb_cam 存在 |
| OK | battery_voltage | 电池电压 12.2 V |
| WARN | servo_bus_errors | rosout 中 dxlBulkRead 错误 2 次（需看是否持续增长） |
| OK | dead_processes | roslaunch 未记录进程退出 |
| OK | time_sync | NTP 已同步 |
| OK | chin_camera_node | /chin_camera 节点可访问 |
| OK | realsense_node | /camera/realsense2_camera 可访问 |
| UNKNOWN | imu_torso | IMU /imu/Torso：无数据（可能事件式或未接入） |
| UNKNOWN | sensor_hub_temperature | SensorHub 温度：无数据 |

## 安全审查

- 规则文件：/Users/sujiye/Documents/大三上/智能交互机器人实验/final/ATTENTION/ATTENTION.md
- SHA-256：746a1d337610a9b8436273fce0964c6b1d0f865b5c54ea984bfd2216b9262f77
- 读取时间：2026-11-26T01:01:56.333Z
- 结论：通过

## 自动修复（知识库优先 + 并行）

### 故障单元与知识库检索

| 组件 | 严重度 | 检查项 | 知识库 | 匹配案例 | 计划来源 | 计划状态 |
|---|---|---|---|---|---|---|
| servo.bus | WARN | servo_bus_errors | 0.70 | servo-bus-intermittent-reads | kb-manual | manual |
| servo.temperature | UNKNOWN | servo_temperature | 0.85 | servo-temperature-zero-readings | kb-manual | manual |
| sensor.imu | UNKNOWN | imu_torso | 1.00 | sensor-imu-no-data | kb-manual | manual |
| sensor.sensorhub | UNKNOWN | sensor_hub_temperature | 0.95 | sensor-sensorhub-no-data | kb-manual | manual |

- 执行模式：apply；并发上限 3；实际最大并发 0；耗时 0 ms
- 结果：成功 0 / 失败 0 / 阻止 0 / 人工 4 / dry-run 0

| 组件 | 状态 | 执行来源 | 知识库案例 | 动作（尝试） | 耗时 ms |
|---|---|---|---|---|---|
| servo.bus | manual_required | kb-manual | — | — | 0 |
| servo.temperature | manual_required | kb-manual | — | — | 0 |
| sensor.imu | manual_required | kb-manual | — | — | 0 |
| sensor.sensorhub | manual_required | kb-manual | — | — | 0 |


### 知识库更新

- 目录：/Users/sujiye/Documents/大三上/智能交互机器人实验/final/kb
- 本次未写入：没有实际执行的修复或复发

## 诊断

### 发现

- [WARN] rosout 中 dxlBulkRead 错误 2 次（需看是否持续增长）（hardware，置信度 medium）
- [UNKNOWN] 未读取到舵机温度（hardware，置信度 low）
- [UNKNOWN] IMU /imu/Torso：无数据（可能事件式或未接入）（sensor，置信度 low）
- [UNKNOWN] SensorHub 温度：无数据（sensor，置信度 low）

### 候选原因

- **servo-bus-intermittent**：总线仍能扫描到全部舵机，读错误更像间歇性通信问题，优先检查供电、线缆、接头和总线负载。（置信度 medium）
  - 证据：dxl_bulk_read_errors=2；servo_scan=ok
- **imu_torso-no-data**：短窗口内没有数据，可能是低频/事件式发布，也可能是传感器未接入；不能直接判故障。（置信度 low）
  - 证据：imu_torso=unknown
- **sensor_hub_temperature-no-data**：短窗口内没有数据，可能是低频/事件式发布，也可能是传感器未接入；不能直接判故障。（置信度 low）
  - 证据：sensor_hub_temperature=unknown

## 人工待办

- 检查舵机供电、USB/串口线缆、接头和总线负载；不要自动修改配置或更换舵机。

## 数据来源说明

- `GetJointAngle` 返回软件缓存角，不是电机实测位置。
- 温度 0 表示无读数，不是 0°C；电池用电压判断，不用 percentage。
- BodyHub 的 Status / ServoPositions / joint 话题是事件式发布，短窗口无消息不等于故障。
