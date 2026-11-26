# 官方文档索引（INDEX）—— 问题 → 文档 → 页码

> 先查这张表，再 grep 文本层；图示页看 `knowledge/manuals/figures/<slug>-pNN.png`。
> 引用官方结论时写「《文档名》 p.N」。手册里的命令≠可自动执行：必须按
> [`ATTENTION/ATTENTION.md`](../ATTENTION/ATTENTION.md) 分类后执行。

## 一、按「我要解决什么问题」查

| 问题 / 症状 | 首选文档 | 关键页 | 要点 |
|---|---|---|---|
| 机器人硬件规格、关节数量、传感器、电池、接口 | 《ROBAN机器人使用入门》 | p.4–9 | 6.60 kg；NUC8i3BEH / i3-8109U / 8G / 120G SSD；22 个关节（头2、肩1×2、臂2×2、爪1×2、腿5×2、脚1×2）；RealSense d435 + USB 下巴相机；电池 4000mAh 11.1V；Ubuntu 16.04 + ROS Kinetic + Python2.7 |
| 开机/关机、舵机加锁、**急停按键** | 《ROBAN机器人使用入门》 p.10–12；《Roban_教员培训手册》 p.1–4 | 入门 p.11–12；教员 p.4 | 开机前须把机器人提至半蹲/站立初始姿态；上电约 40 s 后全舵机加锁。红色按键=紧急解锁全部舵机（主机仍运行）→ 必须按关机流程再重启 |
| 连不上 / 远程连接（ssh、VNC、VSCode Remote-SSH） | 《使用入门》 p.15–28；《教员手册》 p.5–8 | | ssh 形式 `ssh lemon@<机器人IP>`；IP 来自机器人 WiFi 信息页；**IP 必须由用户当前对话给出**（规则 1） |
| WiFi 配置 / 找不到机器人 IP | 《使用入门》 p.12–15 | | 接显示器/鼠标 → 右上角 WiFi → Connect → Connection information 读 IPv4 |
| 机器人不自动进系统，需要手动 login | 《Roban开机无法自动进入系统》 | p.1 | `sudo nano /etc/lightdm/lightdm.conf`，在 `autologin-user=lemon` 下加 `autologin-user-timeout=0`（改文件属人工操作，agent 不自动执行） |
| 怎么自检、自检程序在哪 | 《Roban机器人自检手册》；《教员手册》 p.24（第 9 节 `check`） | 自检 p.1–2 | 终端 `check` 逐项看报错并截图；`./start.sh` 或开机终端里的**红字**报错也是证据 |
| 代码版本太旧 / 程序更新 | 《Roban机器人版本查询手册》；《教员手册》 p.9–10（第 3 节） | 版本 p.1–2 | `cd robot_ros_application/ && git log`（仓库时间早于 **2023-11-29** 需更新）；`lsb_release -a`：Ubuntu 16.04→Roban 1.0，Ubuntu 20.04→Roban 2.0 |
| 系统/镜像需要重刷 | 《Roban机器人离线镜像刷新手册》；《教员手册》 p.16–22（第 6 节，BIOS 在 p.22） | 离线 p.1–10；BIOS p.11–12 | 前提：再生龙启动 U 盘 + **先保存零点参数**；F11 选启动盘 → 简体中文 → 默认键盘 → Clonezilla → 硬盘/分区(存到/来自)镜像 → 本机分区 → … 还原镜像 → 略过检查 → 关机。烧写属整机刷系统，agent 只能指导用户手动完成 |
| 零点（零位）参数在哪、怎么备份 | 《Roban查零点步骤》；《教员手册》 p.24–27（第 10 节） | | `cd ~/.lejuconfig` → `sudo gedit offset.yaml` → 拍照/截图保存；镜像烧完后写回并重启 |
| 零点怎么调、舵机几号对应哪个方向 | 《Roban零点调试》；《教员手册》 p.24–27 | 零点调试 p.1–7, p.11 | 上位机「设置 → 零点调试」；标准零点：1/4 头水平、5 臂水平、6 胯水平、3/8 脚底水平、7 腿竖直；调试顺序从上往下（7/1 → 8/2 → 9/3 → 10/4 → 11/5 → 12/6）；对称舵机同方向同数值 |
| offset.yaml 路径 / 覆盖零点（楼梯案例） | 《教员手册》 p.37 | grep `offset.yaml` | `~/robot_ros_application/footstair/src/motion_interface/config/offset.yaml`；备份/覆盖：`cp ~/.lejuconfig/offset.yaml …` |
| 舵机间隙、结构件变形、脚底不平 | 《教员手册》 p.23–24（第 8–9 节） | p.23–24 | 目视+提起机器人检查；脚底压感测试用 `check`，终端打印红=有问题、绿=正常 |
| 拆机（后壳、头部、音响、胸前、腿部舵机、脚部） | 《Roban拆机培训》 | p.1–24（**图示为主**，文本层很薄） | 后壳→电源充电接口/开关键（红=正、黑=负）→自定义按钮（蓝色数据线）→音响两螺丝→胸前灯+传感器→头部→六麦克风阵列→RealSense 深度相机→腿部/胯部/脚部螺丝 |
| 哪个节点发布/订阅哪些 topic、service | `manuals/topics-services.json`（源自《所有节点 topic 和 service 整理》） | p.1–3 | 见下方“三、节点与数据流” |
| SLAM 建图、楼梯案例、图形化编程、比赛程序常见问题 | 《教员手册》 p.28–84 | 楼梯 p.34–48；SLAM p.51–70；FAQ p.76–84 | `sudo -S bash bodyhub.sh`；`rosnode list` 确认 start.sh 是否已开机启动；「communicate with master!」报错→手动 `~/robot_ros_application/scripts/start.sh` |
| 本项目（RobanLab Doctor）自身的方案与计划 | 《RobanLab_Doctor_产品设计技术方案与研发计划_v2_修改版》 | p.1–11 | 产品/研发方案，不是机器人运维手册；引用时区分「官方」与「我们的方案」 |

## 二、文档清单（11 份）

| 文档（原件在 `manuals/pdf/`） | 页数 | 可搜索文本 | 图示页（需看图） |
|---|---:|---|---|
| `ROBAN机器人使用入门.pdf` | 43 | `text/ROBAN机器人使用入门.md` | p.4–9, p.16–18 |
| `Roban_教员培训手册_20220111.pdf` | 84 | `text/Roban_教员培训手册_20220111.md` | 若干（p.2, p.10–13 等） |
| `Roban机器人自检手册.pdf` | 2 | `text/Roban机器人自检手册.md` | 2 张截图 |
| `Roban机器人版本查询手册.pdf` | 2 | `text/Roban机器人版本查询手册.md` | p.1–2 |
| `Roban查零点步骤.pdf` | 1 | `text/Roban查零点步骤.md` | p.1 |
| `Roban零点调试(1).pdf` | 12 | `text/Roban零点调试-1-.md` | p.6, p.8, p.10, p.12 |
| `Roban拆机培训.pdf` | 24 | `text/Roban拆机培训.md` | **全部页**（107 页渲染的 PNG 里占多数） |
| `Roban机器人离线镜像刷新手册.pdf` | 12 | `text/Roban机器人离线镜像刷新手册.md` | p.1–12 |
| `Roban开机无法自动进入系统(1).pdf` | 1 | `text/Roban开机无法自动进入系统-1-.md` | p.1 |
| `所有节点 topic 和 service 整理.pdf` | 3 | `text/所有节点-topic-和-service-整理.md` | 无图 |
| `RobanLab_Doctor_产品设计技术方案与研发计划_v2_修改版.pdf` | 11 | `text/RobanLab_Doctor_..._修改版.md` | 有图表 |

共 183 页；107 页文本层 <160 字符，已渲染为 PNG 存于 `manuals/figures/`，页级元数据在 `manuals/pages.json`。

## 三、节点与数据流（自检/诊断时对照）

| 组件 | 关键 topic / service | 官方用途 | 诊断用法 |
|---|---|---|---|
| 下巴相机 `camera.chin` | `/chin_camera/image` | 视频流 | `rostopic hz /chin_camera/image` 看是否 ≥5 Hz；节点重启是白名单动作 |
| 颜色识别 | `/chinCamera_color_recognition`, `/color_recognition` | 颜色识别 service | 若 service 不存在 → 节点未启动 |
| 人脸 / 手势 | `/ros_face_node/face_detect`, `/ros_gesture_node/gesture_detect` | 视觉识别 | 同上 |
| 麦克风阵列 | `/micarrays/wakeup` | 唤醒事件 | 无数据 → 音频链路故障 |
| BodyHub 状态机 | `/MediumSize/BodyHub/Status`, `/MediumSize/BodyHub/WalkingStatus`, `/requestGaitCommand` | 状态与步态 | `preReady`/`pause`、`masterID=0` 是修复前置条件 |
| 运动指令（**需用户批准**） | `/MediumSize/BodyHub/HeadPosition`, `/MotoPosition`, `/jointControl`, `/gaitCommand`, `/VirtualPanel` | 头部/关节/步态 | ATTENTION 规则 2、3 |

## 四、搜索方法

```bash
# 关键词搜索，返回文档+页码+片段
python3 tools/manual_search.py "零点" --doc 零点调试
python3 tools/manual_search.py "offset.yaml"
python3 tools/manual_search.py "红字" --context 3

# 直接 grep（带 <!-- page N --> 标记）
grep -n -i "check" knowledge/manuals/text/Roban_教员培训手册_20220111.md
```
