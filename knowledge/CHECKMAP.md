# 官方自检项 ↔ agent 自动检测项 对照表

> 用途：让「官方怎么做自检」与「agent 自动检测什么」一一对应，报告里能说明
> 哪一项是自动判定、哪一项必须人工用官方 `check` 程序确认。
> 生成依据：`knowledge/manuals/` 里的官方手册；代码在 `skills/selfcheck.js`、
> `skills/official-baseline.js`、`templates/probe.sh`。

## 一、自动检测项（只读，可自动执行）

| agent 检查项 | 判据来源（官方出处） | 判定逻辑 |
|---|---|---|
| `ssh` | 《使用入门》p.24、《教员手册》p.5（ssh `lemon@机器人IP`） | 连接失败 = fail |
| `robot_model` | 《版本查询手册》p.2：Ubuntu 16.04 → Roban 1.0，20.04 → Roban 2.0 | 识别机型；无输出 = unknown |
| `ros_env` | 《使用入门》p.6（ROS Kinetic）；探测脚本按 kinetic/noetic/melodic 回退 | 找不到 ROS 环境 = warn/unknown |
| `code_freshness` | 《版本查询手册》p.1：仓库时间早于 **2023-11-29** 需更新 | 早于阈值 = warn（人工执行更新脚本） |
| `ros_master` / `expected_nodes` | 《教员手册》p.59-60：开机默认执行 `scripts/start.sh`；缺 bodyhub/realsense 节点或 `Unable to communicate with master!` | 节点缺失 = fail（但见 `boot_window` 宽限期） |
| `master_unreachable_logs` | 《教员手册》p.60 | 日志出现该报错 = warn，人工执行 start.sh |
| `boot_autologin` | 《开机无法自动进入系统》p.1：`autologin-user=lemon` + `autologin-user-timeout=0` | 缺配置 = warn（人工改 lightdm.conf） |
| `boot_autostart` | 《教员手册》p.59：`~/robot_ros_application/scripts/start.sh` 开机启动所有节点 | 脚本缺失或无 roscore/roslaunch 进程 = warn/fail |
| `boot_window` | 《使用入门》p.12、《教员手册》p.4：上电约 **40 s** 后全舵机加锁并恢复初始站立姿态 | 开机不足 120 s → 节点/话题缺失不判故障，只 warn |
| `bodyhub_state` / `bodyhub_owner` / `bodyhub_queues` | 《使用入门》p.11-12（加锁/初始姿态）；状态机 topic `/MediumSize/BodyHub/Status` | 修复前必须 `preReady`/`pause` 且 `masterID=0` |
| `joint_cache` | 《使用入门》p.7：关节共 **22** 个（头2、肩1×2、臂2×2、爪1×2、腿5×2、脚1×2） | 返回 22 = ok |
| `servo_scan` | 官方拆机培训 p.9-11（腿部舵机）+ 22 关节规格 | 总线缺 ID = fail |
| `servo_temperature` | 无官方判据（工程经验：0 = 无读数，不是 0°C） | ≥70°C fail；有 0 读数 warn |
| `camera_chin` / `chin_camera_node` / `usb_cam_device` | 《使用入门》p.6-7：USB 下巴相机 2592×1944 | 无数据 + 节点不可达 = fail（白名单重启候选） |
| `camera_color` / `realsense_node` / `realsense_usb` | 《使用入门》p.6：Intel RealSense D435（1280×720@30fps） | lsusb 未见 = warn |
| `battery_voltage` / `battery_topic` | 《使用入门》p.7：4000mAh / 11.1V 3S（满电约 12.6V） | <10.8V fail，<11.5V warn |
| `zero_point_backup` | 《查零点步骤》p.1；《教员手册》p.37：`~/.lejuconfig/offset.yaml` 与 footstair 的 `offset.yaml` | 文件缺失/为空 = warn（镜像刷新前必须备份零点） |
| `mic_array` | 《拆机培训》p.7（六麦克风阵列）；`/micarrays/wakeup` | 事件式发布，短窗口无数据 = unknown |
| `official_check_coverage` | 《自检手册》p.1-2；《教员手册》p.24（脚底压感测试） | 有可读 topic → 可自动检测；没有 → 需人工跑 `check` |
| `disk` | 《使用入门》p.6：120G SSD | ≥95% fail，≥85% warn |
| `dead_processes` | 《教员手册》p.10（更新/启动日志） | roslaunch 进程退出记录 = warn（历史证据不触发自动修复） |

## 二、官方要求但 agent 不能自动做的（只给人工步骤）

| 官方步骤 | 出处 | agent 行为 |
|---|---|---|
| 运行 `check` 自检程序逐项看编号报错 | 《自检手册》p.1；《教员手册》p.24 | 只静态识别程序路径与自检项名称，不执行（需要交互输入） |
| 看终端红字报错 | 《自检手册》p.2 | 等价只读检查：rosout 里的 `[ERROR]`、`Unable to communicate with master`、`process has died` |
| 执行 `~/robot_ros_application/scripts/start.sh` 启动节点 | 《教员手册》p.60 | **禁止**自动执行（会重启 roscore/BodyHub，ATTENTION 规则 3） |
| 零点调试（上位机 1–12 号舵机） | 《零点调试》p.1-7 | 需要用户逐次批准；agent 只读 offset 并生成补丁，写入由人工执行 |
| 镜像刷新（再生龙 U 盘 + BIOS After Power Failure = Power On） | 《离线镜像刷新手册》p.1、p.12；《教员手册》p.16-22 | 只指导，不执行 |
| 拆机 | 《拆机培训》p.1-24 | 只指导，不动手 |
| 红色紧急按键 | 《使用入门》p.11-12；《教员手册》p.4 | 提示风险：按下 = 全部舵机解锁（主机仍运行），站立机器人会失去支撑 |

## 三、停机/急停的正确做法（检测与修复流程都要用）

1. 最可靠：**切断机器人电源**（背部电源开关向左）。
2. 需要关节释放时：先人工支撑或悬架固定，再按官方关机流程；红按键只解锁舵机，不等于安全停止。
3. 发起命令的终端按 **Ctrl-C** 终止当前前台进程。
4. **断开 SSH/关闭网页不算停止**：机器人端可能继续执行已排队的指令。
