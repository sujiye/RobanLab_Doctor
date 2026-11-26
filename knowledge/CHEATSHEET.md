# Roban 命令速查（按安全分类）

来源：官方手册（见 [INDEX.md](INDEX.md)）。分类依据
[`ATTENTION/ATTENTION.md`](../ATTENTION/ATTENTION.md)：**只读**可自动执行；
**非运动修复**需 `--confirm` + 前置条件；**运动**需用户逐次批准并给出立即停止方式；
**禁止**一律只给人工建议。

## A. 只读（可自动执行）

| 目的 | 命令 | 出处 |
|---|---|---|
| 官方自检程序 | `check`（逐项看报错，截图） | 《自检手册》 p.1；《教员手册》 p.24 |
| 看开机/启动报错 | 终端里执行 `./start.sh` 或观察开机终端红字 | 《自检手册》 p.2 |
| 节点是否在跑 | `rosnode list`（查 `start.sh` 是否已开机启动） | 《教员手册》 p.59–60 |
| 数据流是否活着 | `rostopic hz /chin_camera/image` | 《使用入门》 p.29–30（浏览器 `http://<IP>:8080` 看视频流） |
| 代码仓库版本 | `cd robot_ros_application/ && git log`（早于 2023-11-29 需更新） | 《版本查询手册》 p.1 |
| 机型/系统版本 | `lsb_release -a`（16.04→Roban 1.0，20.04→Roban 2.0） | 《版本查询手册》 p.2 |
| 现有零点参数 | `cd ~/.lejuconfig && sudo gedit offset.yaml`（**只读时只看，不写**） | 《查零点步骤》 p.1；《教员手册》 p.37 |
| 零点参数另一路径 | `~/robot_ros_application/footstair/src/motion_interface/config/offset.yaml` | 《教员手册》 p.37 |
| 开机自启排查 | 看 `/etc/lightdm/lightdm.conf` 的 `autologin-user=lemon` | 《开机无法自动进入系统》 p.1 |

远程连接方式（ssh `lemon@机器人IP` / VNC / VSCode Remote-SSH）见《使用入门》 p.15–28、《教员手册》 p.5–8。
**机器人 IP 只能来自用户当前消息**（规则 1），文档里的示例 IP（如 172.20.10.4）一律不作为连接目标。

## B. 非运动修复（白名单，需 `--confirm`）

- `restart-chin-camera`：重启下巴相机节点（非运动节点）。需 BodyHub 处于 `preReady`/`pause`、`masterID=0`，
  且复检 `/chin_camera/image ≥ 5 Hz` 持续 5 s。冷却期内复发 → 转人工，不反复重启。

## C. 会让机器人运动（需用户逐次批准 + 立即停止方式）

- 上位机「零点调试」：调整 1–12 号舵机零点 → 关节会运动。《零点调试》 p.1–7
- 步态/行走、虚拟手柄：`/gaitCommand`、`/VirtualPanel`、`/MediumSize/BodyHub/*`
- SLAM 建图、楼梯案例、图形化编程动作：`sudo -S bash bodyhub.sh` + 案例脚本（《教员手册》 p.31–42 楼梯/动作、p.51–56 SLAM，`start.sh` 启动节点见 p.59–60）

开始前必须说明：动哪个关节、目标角度/速度/时长、预期看到什么、碰撞/跌落风险、如何立刻停止
（硬件急停/断电最可靠；终端 Ctrl-C；**断开 SSH 不等于停止**）。

## D. 禁止自动执行（只给人工建议）

- `reboot` / `shutdown` / 拔电源 / 断电
- `killall roslaunch`、重启 `roscore` / BodyHub
- `SetServoLockState*` 卸力、`Torque_Enable=0`、写舵机寄存器、`SyncWrite*` / `InstWrite*`
- 直接写 `offset.yaml` / `dxlInitPose.yaml`（零点写入必须由用户手动执行）
- 镜像烧写 / 再生龙刷新（《离线镜像刷新手册》 p.1–12；先保存零点参数，用户现场操作）
- 拆机（《拆机培训》 p.1–24）：涉及电池、舵机、线缆，agent 只指导，不动手
