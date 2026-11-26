# Roban 自检报告

- 机器人：lemon-NUC8i3BEH (10.29.101.186)
- 采集时间：2026-11-19 11:02:48 +0800
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
| WARN | servo_temperature | 最高 53°C；5 个 ID 无温度读数（0 不等于 0°C） |
| OK | camera_color | RealSense 彩色图：16.6 Hz |
| FAIL | camera_chin | 下巴相机无数据且节点不可访问；/dev/usb_cam 存在时是安全重启候选 |
| OK | battery_topic | 电池话题：20.0 Hz |
| OK | usb_servo_device | /dev/usb_servo 存在 |
| OK | usb_cam_device | /dev/usb_cam 存在 |
| OK | battery_voltage | 电池电压 12.2 V |
| WARN | servo_bus_errors | rosout 中 dxlBulkRead 错误 29 次（需看是否持续增长） |
| WARN | dead_processes | roslaunch 记录了 3 个进程退出 |
| OK | time_sync | NTP 已同步 |
| WARN | chin_camera_node | /chin_camera 节点不可访问 |
| OK | realsense_node | /camera/realsense2_camera 可访问 |
| UNKNOWN | imu_torso | IMU /imu/Torso：无数据（可能事件式或未接入） |
| UNKNOWN | sensor_hub_temperature | SensorHub 温度：无数据 |

## 安全审查

- 规则文件：/Users/sujiye/Documents/大三上/智能交互机器人实验/final/ATTENTION/ATTENTION.md
- SHA-256：bbcd6172e1ecb322ff079731ba2dbd7c71021b285172795d478f100f1f92c3ac
- 读取时间：2026-11-19T03:03:19.453Z
- 结论：通过
- 动作分类：
  - restart-chin-camera：允许（非运动节点重启；不触碰 BodyHub、舵机扭矩或关节位置）

## 自动修复（知识库优先 + 并行）

### 故障单元与知识库检索

| 组件 | 严重度 | 检查项 | 知识库 | 匹配案例 | 计划来源 | 计划状态 |
|---|---|---|---|---|---|---|
| camera.chin | FAIL | expected_nodes, camera_chin, dead_processes, chin_camera_node | 1.00 | camera-chin-startup-order | kb | ready |
| servo.temperature | WARN | servo_temperature | 0.90 | servo-temperature-zero-readings | kb-manual | manual |
| servo.bus | WARN | servo_bus_errors | 0.70 | servo-bus-intermittent-reads | kb-manual | manual |
| sensor.imu | UNKNOWN | imu_torso | 1.00 | sensor-imu-no-data | kb-manual | manual |
| sensor.sensorhub | UNKNOWN | sensor_hub_temperature | 0.95 | sensor-sensorhub-no-data | kb-manual | manual |

- 执行模式：apply；并发上限 3；实际最大并发 1；耗时 16763 ms
- 结果：成功 1 / 失败 0 / 阻止 0 / 人工 4 / dry-run 0

| 组件 | 状态 | 执行来源 | 知识库案例 | 动作（尝试） | 耗时 ms |
|---|---|---|---|---|---|
| camera.chin | success | kb | camera-chin-startup-order | restart-chin-camera=success | 16762 |
| servo.temperature | manual_required | kb-manual | — | — | 0 |
| servo.bus | manual_required | kb-manual | — | — | 0 |
| sensor.imu | manual_required | kb-manual | — | — | 0 |
| sensor.sensorhub | manual_required | kb-manual | — | — | 0 |


### 知识库更新

- 目录：/Users/sujiye/Documents/大三上/智能交互机器人实验/final/kb
- 事件日志：/Users/sujiye/Documents/大三上/智能交互机器人实验/final/kb/events.jsonl（新增 1 条）
- 新增案例：无
- 更新案例：camera-chin-startup-order

## 诊断

### 发现

- [FAIL] 缺少期望节点：/chin_camera（software，置信度 high）
- [FAIL] 下巴相机无数据且节点不可访问；/dev/usb_cam 存在时是安全重启候选（software，置信度 high）
- [WARN] 最高 53°C；5 个 ID 无温度读数（0 不等于 0°C）（hardware，置信度 medium）
- [WARN] rosout 中 dxlBulkRead 错误 29 次（需看是否持续增长）（hardware，置信度 medium）
- [WARN] roslaunch 记录了 3 个进程退出（software，置信度 medium）
- [WARN] /chin_camera 节点不可访问（software，置信度 medium）
- [UNKNOWN] IMU /imu/Torso：无数据（可能事件式或未接入）（sensor，置信度 low）
- [UNKNOWN] SensorHub 温度：无数据（sensor，置信度 low）

### 候选原因

- **chin-camera-startup-order**：下巴相机节点可能在 /dev/usb_cam 建立之前启动，随后退出；设备节点现在存在，重启非运动相机节点可以验证这个假设。（置信度 high）
  - 证据：camera_chin=fail；chin_camera_node=warn；usb_cam=OK；dead_processes=3
- **servo-bus-intermittent**：总线仍能扫描到全部舵机，读错误更像间歇性通信问题，优先检查供电、线缆、接头和总线负载。（置信度 medium）
  - 证据：dxl_bulk_read_errors=29；servo_scan=ok
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

## 复检

- 修复目标通过：true
- 复检前：OK 15 / WARN 4 / FAIL 2 / UNKNOWN 2
- 复检后：OK 18 / WARN 3 / FAIL 0 / UNKNOWN 2
- 状态变化：
  - expected_nodes: FAIL -> OK（期望节点全部在线）
  - camera_chin: FAIL -> OK（下巴相机：10.5 Hz）
  - chin_camera_node: WARN -> OK（/chin_camera 节点可访问）

## 人工待办

- 检查舵机供电、USB/串口线缆、接头和总线负载；不要自动修改配置或更换舵机。
- 确认无温度读数的 ID 是否为本机未安装或型号不支持温度回读的舵机。

## 数据来源说明

- `GetJointAngle` 返回软件缓存角，不是电机实测位置。
- 温度 0 表示无读数，不是 0°C；电池用电压判断，不用 percentage。
- BodyHub 的 Status / ServoPositions / joint 话题是事件式发布，短窗口无消息不等于故障。
