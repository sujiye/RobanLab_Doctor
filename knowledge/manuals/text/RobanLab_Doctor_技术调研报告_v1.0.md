# RobanLab_Doctor_技术调研报告_v1.0

- 源文件：`knowledge/manuals/pdf/RobanLab_Doctor_技术调研报告_v1.0.pdf`
- 页数：23 · 图片对象：69
- 转换工具：`tools/extract_manuals.py`（PyMuPDF 1.28.0）
- 页码标记：下文每页以 `<!-- page N -->` 开头，引用时写「《文档名》 p.N」。
- 图片页（文本层 <160 字符）：已渲染为 `knowledge/manuals/figures/` 下的 PNG 并以图片链接嵌入。

---
<!-- page 1 -->

RobanLab Doctor 技术调研报告 v1.0 · 第 1 页

# RobanLab Doctor

### 面向机器人实验课程的 Agent 驱动自检与故障诊断平台

技术调研报告（开题报告）

课程：智能交互机器人实验 · 期末大作业

依据：《RobanLab_Doctor_模块化方案 v1.0》(2026-11-22) 与现有半成品代码 final/ (2026-11-19 状态)

版本：v1.0    日期：2026-11-25

### 目录

``

1  摘要

``

2  研究背景与问题定义

``

3  相关工作与技术基础综述

``

4  需求分析

``

5  现有半成品实现现状分析

``

6  总体技术方案

``

7  关键技术问题与创新点

``

8  实验设计与评价指标

``

9  实施路线与里程碑

``

10 预期成果

``

11 结论

``

参考文献

<!-- page 2 -->

RobanLab Doctor 技术调研报告 v1.0 · 第 2 页

# 1 摘要

机器人实验课程中，学生最常见的困境不是“不会写代码”，而是“程序跑起来了，机器人却没动”——故障可

能来自学生代码、机器人端的 ROS 软件环境，也可能来自舵机、相机、总线等设备侧，三者的表象高度相

似，而学生缺乏区分它们的工具与经验。本报告围绕 RobanLab Doctor 这一面向“智能交互机器人实验”课程

的平台，回答三个问题：第一，如何用大模型（DeepSeek）与确定性规则结合的方式，把“实验失败”转化为

可验证的故障归因；第二，在机器人端只有有限可观测接口（软件缓存角、舵机反馈、温度、话题频率）的

前提下，诊断的边界在哪里；第三，如何让一个自动修复系统在不损坏设备、不造成安全风险的前提下落

地。

现有半成品已经实现了“SSH 只读探测 → 规则化自检 → 故障归并 → 知识库检索 → 白名单修复（默认 dry-

run）→ 复检 → 经验回写 → Markdown 报告”的完整确定性闭环，并在 2026-11-19 的实机上完成多次真实验

证：一次下巴相机节点故障被知识库命中并自动恢复（19.2 s，复检 10.5 Hz），随后 7.5 分钟内复发，系统因

冷却期策略自动阻止重复重启并转人工。同时，平台缺少 Web 前端、FastAPI 后端、真正的 RAG 检索、标

准运动测试执行器与三维预演，也没有把 DeepSeek Agent 接入诊断主干。

本报告的核心结论是：本项目的价值不在于“让大模型获得 SSH 权限”，而在于**把机器人诊断证据的语义边

界（命令角 ≠ 缓存角 ≠ 编码器反馈 ≠ 机械运动）固化成不可绕过的工作流与安全闸门**，使大模型只能在

经验证的工具与权限分级内行动。据此提出 M0–M7 的实施路线与 D01–D15 的故障测试集，并给出可量化

的验收指标。

**关键词**：LLM Agent；故障诊断；工作流编排；确定性规则引擎；证据数据层；检索增强生成；安全权限

分级；ROS；Roban 机器人

# 2 研究背景与问题定义

## 2.1 实验场景与痛点

“智能交互机器人实验”课程要求学生在 Roban 仿人机器人上运行 Python/ROS 实验程序：视觉伺服、头部控

制、关节运动、舞蹈动作帧、PID 调参等。学生通过 SSH 登录机器人本机，在机器人上执行脚本。故障发生

时的典型表述是：

``

“脚本报错 ModuleNotFoundError / SyntaxError”；

``

“脚本没有报错，但右臂完全不动”；

``

“相机没有画面”；

<!-- page 3 -->

### RobanLab Doctor 技术调研报告 v1.0 · 第 3 页

### 

### “IMU 数值不对 / 传感器没有数据”；

### 

### “换了一台机器人就正常了，那这台是不是坏了？”

### 这些表述指向四类完全不同的根因，而课堂中学生（乃至指导教师）难以快速区分。传统调试方法（人工读

### 日志、逐条执行 ROS 命令）效率低、依赖个人经验，且经验无法沉淀复用。

## 2.2 问题的形式化定义

### 设一次实验失败为事件 E。诊断任务即求一个归因函数：

classify(E) → { student_software, robot_software, suspected_device, insufficient_evidence }

### 其约束是：

### 1. 归因必须附带**可追溯证据**（工具调用、时间戳、来源接口、原始日志引用）；

### 2. 归因必须**可复测验证**：修复后必须满足该故障预先定义的复测标准；

### 3. 归因不得越界：在缺乏电流、电压、硬件故障码、输出轴真实机械位置等观测时，只能表述为“疑似设备侧

### 异常”，不能断言“电机损坏”；

### 4. 任何可能引起物理运动或关节扭矩变化的操作必须经过逐次人工确认并具备可靠停止机制。

## 2.3 研究目标

### 目标

### 说明

### 可验收结果

G1 连接与预检

SSH 连接、远端环境识别、实验前一键

自检

分项状态 + 总体报告

G2 确定性诊断

不依赖大模型的分层规则：Python/

ROS/BodyHub/关节/传感器

检查项 → 故障单元 → 严重度

G3 Agent 诊断

自然语言症状 + 工具调用 + 证据解释

步骤、证据、结论、不确定性

G4 受控修复

备份 → 补丁 → 复测 → 回滚

修复成功且复测通过

G5 软硬件分流

联合控制链路、反馈与人工观察

四类归因 + 换机建议

G6 经验沉淀

案例库与审计日志

可检索、可统计成功率

G7 标准运动测试（扩展)

经验证的用例 + 三维预演 + 机器人端

执行器

可复现的轨迹与误差指标

<!-- page 4 -->

RobanLab Doctor 技术调研报告 v1.0 · 第 4 页

# 3 相关工作与技术基础综述

## 3.1 大模型 Agent 与工具调用

DeepSeek 等模型通过 Messages/Responses API 的 tool_calls 机制支持结构化工具调用，使 Agent 可以在受控函

数集合内选择诊断动作[1]。但工具调用本身不保证顺序与安全：模型可能跳过关键检查、重复调用、或在证

据不足时给出结论。因此业界普遍采用**编排层**（LangGraph 等状态图、或自定义状态机）把“必须执行的

顺序、条件分支、人工暂停、重试上限”固化到代码中，并通过 human-in-the-loop 中断点实现审批[2]。

对本项目的启示：诊断主干不能只写在 system prompt 或 Skill 文档中。现有半成品正是用显式的 workflow 阶

段表（STEPS / STEPS_AUTO）实现顺序，这一做法符合上述共识。

## 3.2 检索增强生成（RAG）与知识边界

RAG 能把课程文档、厂家手册、历史案例提供给模型[3]。但机器人诊断的特殊性在于**知识有三类不同可信

度**：

1. 结构化设备事实（关节 ID、话题名、消息类型、接口副作用）——必须按实机版本管理；
2. 文档知识（手册、课件、源码注释）——需要来源、版本与适用性标注；
3. 实时证据（当前 ROS 状态、舵机反馈、日志）——只能由工具采集，不能由历史文档替代。

已有自愈机器人架构（如 RoSHA 的多机器人自愈框架[4]）强调“知识 + 感知 + 决策”分层，但其假设是机器

人具备充分的传感器闭环。Roban 的可观测性明显受限，因此本项目的 RAG 必须服务于“解释与线索”，而

非“安全阈值来源”。

## 3.3 机器人故障诊断与数字孪生

ROS 生态提供了 rosnode/rostopic/rosservice 等观测手段[5]，课程仿真环境（CoppeliaSim + ROS + bodyhub +

ik_module）为轨迹预演提供了可复用资源[6]。三维预演与数字孪生的价值在于“执行前可解释、执行后可对

比”，但仿真通过不等于实机安全，这一边界必须在系统中显式建模。

## 3.4 现有方案与本项目的差异

维度

通用代码调试 Agent

`RobanLab Doctor`

目标

修复代码

区分“代码 / 环境 / 设备 / 未知”四类归

因

执行环境

本地沙箱

真实机器人（物理风险）

证据类型

文本日志

ROS 状态 + 舵机反馈 + 人工观察

<!-- page 5 -->

### RobanLab Doctor 技术调研报告 v1.0 · 第 5 页

安全模型

权限沙箱

R0–R3 分级 + 逐次审批 + 机器人端停

止机制

知识来源

通用训练知识

课程 + 厂家 + 本地源码 + 自学习案例

复测标准

测试通过

每个故障单元自定义复测判据（频率、

状态、队列）

# 4 需求分析

## 4.1 用户与入口

### 

### **主要用户**：完成课程实验的学生；次要用户：指导教师与实验室管理员。

### 

### **入口**：学生电脑浏览器；后端在学生电脑本地运行；机器人端适配器在机器人本机运行。

### 

### **模型能力**：DeepSeek API 用于自然语言理解、工具选择、证据解释与报告生成。

### 

### **人工参与**：物理观察、运动测试、系统级变更必须人工确认。

## 4.2 功能范围与优先级

### 优先级

### 功能

### 说明

`P0`

连接管理、一键预检、Agent 诊断、远

端代码/日志分析、受控修复、软硬件

分流、报告

必须交付

`P1`

课程知识检索、实验预检画像、关节诊

断面板、人工观察输入、案例沉淀

特色增强

`P2`

22 关节三维遥控、课程调参可视化、零

位辅助标定

辅助功能，不阻塞 P0

## 4.3 约束与非功能需求

### 1. **旧环境约束**：实机为 Ubuntu 16.04 / ROS Kinetic / Python 2.7.12 & 3.5.2，不能把现代 Python 依赖直接部

### 署到机器人端。

### 2. **可审计性**：所有工具调用、审批、修改、复测必须留痕。

### 3. **最小副作用**：接口“读取”未必无副作用（源码显示某些位置读取服务可能切换 BodyHub 状态）。

### 4. **隐私**：机器人 IP 不得进入知识库、报告不得泄露连接凭证；API Key 与 SSH 密钥仅后端持有。

### 5. **离线可运行**：课程现场网络不稳定时，诊断主干与规则引擎应可离线执行。

<!-- page 6 -->

### RobanLab Doctor 技术调研报告 v1.0 · 第 6 页

# 5 现有半成品实现现状分析

## 5.1 规模与结构

### 现有 `final/` 目录共 78 个文件，实现代码约 7900 行（skills 4739 行 + workflow 2519 行，其中测试 997 行 +

### templates 184 行 + tools 358 行），文档与报告约 3800 行（agent/README 496、USAGE 593、kb/README

### 122、ATTENTION 112、18 份实机报告 1889 等）。**零 npm 依赖**，全部使用 Node 标准库（`fs`、

### `child_process`、`crypto`、`http`、`node:test`），通过系统 `ssh` 命令（密钥认证，`BatchMode=yes`、

### `ConnectTimeout=8`、`StrictHostKeyChecking=accept-new`，可选 SOCKS 代理）访问机器人；22 个同构 skill

### 模块（`{id,title,description,inputs,run(ctx,input)}`）由 `skills/index.js` 注册，workflow 只依赖一个注入的 `ctx`

### 适配对象。

### 目录

### 作用

### 关键文件

``ATTENTION/``

最高优先级安全规则（唯一来源）

`ATTENTION.md`(112 行)

``skills/``

24 个同构 skill 模块（探测、自检、归

因、修复、学习、报告、标定、视觉）

```text
`selfcheck.js`, `fault-units.js`, `kb.js`,
`repair-parallel.js`, `safety.js`
`workflow/`
```

工作流编排 + CLI 适配器 + 测试

`workflow.js`, `dsh-workflow.js`, 3 个 test

文件

``kb/``

经验知识库（5 个种子案例 + 追加式审

计日志）

```text
`cases/*.json`, `events.jsonl`
`templates/`
```

远端只读探测脚本与 LLM 分析层模板

`probe.sh`(106 行), `dsh-analysis-

```text
workflow.js`
`tools/phone-camera/`
```

手机相机测量辅助页（零依赖 HTTP）

```text
`server.js`, `public/index.html`
`calibration/` `diagnosis/`
```

标定与视觉诊断产物目录

README + 子目录

``.dsh/commands/``

5 个斜杠命令入口

`/roban-detect` 等

## 5.2 已实现的五条工作流

### 任务

### 阶段序列

### 状态

```text
A `roban-selfcheck`
safety → probe → selfcheck → diagnose
→ safety-review → repair → verify →
report
```

已实现

```text
B `roban-auto-repair`
safety → probe → selfcheck → diagnose
→ plan → safety-review → repair-
parallel → verify → learn → report
```

已实现

```text
C `roban-zero-calibration`
safety → plan → measure → prepare →
verify → report
```

已实现（人工在环）

D 手动转动识别关节 ID

baseline → diff → zero → 生成候选

已实现

<!-- page 7 -->

### RobanLab Doctor 技术调研报告 v1.0 · 第 7 页

```text
offset
E `roban-general-diagnosis`
safety → intake → visual → probe →
selfcheck → hypotheses → safety-review
→ repair → report
```

已实现（LLM 看图 + 规则归因）

### 其中任务 B 是核心：故障检查项按组件归并为“故障单元”，知识库优先匹配，失败则回退到组件安全阶梯，

### 成功/失败经验回写，且支持并发（默认 3，可通过 `ROBAN_REPAIR_CONCURRENCY` 调整）与资源锁串

### 行化。

## 5.3 证据采集：只读探测的字段覆盖

### `templates/probe.sh` 在机器人端执行，输出 30+ 结构化字段：

### 类别

### 采集项

主机

hostname、时间、uptime、NTP 同步状态、磁盘使用率、可

用内存

设备节点

`/dev/usb_servo`、`/dev/usb_cam`、`/dev/video*` 数量

`ROS`

Master 可达性、节点数与列表、`/BodyHubNodeNew` 可达性

`BodyHub`

`GetStatus` 状态、poseQueueSize、jointQueueSize、

``GetMasterID``

舵机

`GetJointAngle`（22 个缓存角）、`PresentTemperature`、零

读数 ID 列表、`ScanServo`（仅 `preReady`）

传感器/话题

```text
`/camera/color/image_raw`、`/chin_camera/image`、`/
MediumSize/SensorHub/BatteryState`、`/imu/Torso`、`/
```

MediumSize/SensorHub/Temperature` 的实测 Hz

电池

`voltage、percentage、present`

日志

rosout 中 `dxlBulkRead error` 计数、`timerThread() timeout`

计数、`[ERROR]` 行数、roslaunch 中 “process has died” 名称

与数量

### 这构成“可复现的基线快照”，是后续规则判定与知识库签名匹配的基础。

## 5.4 规则化自检与故障归并

### `selfcheck.js` 是纯函数式判定（便于测试），输出 `ok/warn/fail/unknown` 四类状态；阈值包括磁盘 ≥95% 为

### fail、电池 <10.8 V 为 fail、相机话题 <5 Hz、温度峰值 ≥70 °C 等，**无数据一律记 `unknown` 而不是

### fail**。`fault-units.js` 把 23 个检查项映射到 12 个组件（`camera.chin`、`camera.realsense`、`servo.bus`、

### `servo.temperature`、`power.battery`、`sensor.imu`、`sensor.sensorhub`、`control.bodyhub`、`system.host`、

<!-- page 8 -->

### RobanLab Doctor 技术调研报告 v1.0 · 第 8 页

### `system.ros`、`system.nodes`、`system.ssh`），按 `fail > warn > unknown > ok` 排序生成修复单元，每个单元声

### 明 `targets`、`locks`、`preconditions`、`verification`、`generatedPlaybook`。其中 `LIVE_SIGNALS` 判定是关

### 键：**只有存在实时信号才 `autoRepairable`，若仅有 `dead_processes` 这类历史日志证据，单元降级为人工观

### 察**，防止“历史日志触发自动重启”。

### **关键设计**：同一根因触发的多个检查项（例如 `camera_chin`、`chin_camera_node`、`expected_nodes`、

### `dead_processes`）合并为一个单元，避免重复执行与资源竞争；只有 `autoRepairable=true` 的单元进入执行

### 队列，其余产出人工建议。

## 5.5 知识库与经验学习

### 案例 schema（schemaVersion=1）包含 `component`、`checkIds`、`signature.predicates`、`keywords`、

### `autoRepairable`、`playbook`、`preconditions`、`verification`、`cooldownMs`、`stats`、`degraded`、`source`。

### 匹配逻辑：

### 1. 候选必须组件相同且谓词全部成立；

### 2. 打分 = 组件命中 0.5 + 检查项重合 0.3 + 关键词命中 0.2；

### 3. `degraded`（连续失败 ≥2 次且从未成功）跳过；

### 4. 冷却期（默认 15 分钟）内复发 → 计划 `blocked`，写入 `recurrence` 事件并转人工；

### 5. 未命中 → 组件安全阶梯（generated）；仍失败 → `failed` 并写审计日志。

### 实测数据（`kb/events.jsonl`，2026-11-19）：

时间(UTC)

事件

结果

`02:04:16`

repair-attempt（KB 命中 `camera-chin-

`startup-order`）`

success，19.2 s，复检

`camera_chin/chin_camera_node/expecte`

d_nodes 全部 ok

`02:11:43`

recurrence（7.5 分钟后复发）

自动重启被阻止，转人工检查 USB/供

电

```text
02:25:00
repair-attempt
success，17.2 s
02:29:10
```

recurrence（4.2 分钟后复发）

阻止自动重启，转人工

```text
03:04:08
repair-attempt
success，16.8 s
```

<!-- page 9 -->

RobanLab Doctor 技术调研报告 v1.0 · 第 9 页

同时 `dxlBulkRead error` 计数从 19 → 21 → 23 → 29 持续增长，而 `ScanServo` 仍覆盖 1–22 全部舵机，说明

总线存在间歇性通信问题但未构成掉线故障。温度回读中 ID 14/15/19/21/22 返回 0，被明确标注为“无读

数，不是 0 °C”。

## 5.6 安全与权限：代码层强制而非提示层承诺

`ATTENTION.md` 四条硬规则被 `safety.js` 在每次执行前重新读取并执行：

1. **知识库不得记录或使用机器人 IP**：写入前 IPv4 脱敏为 `[REDACTED_IP]`；读取时忽略 IP/主机字段；

当前 IP 必须来自用户当前消息。每次审查记录 ATTENTION 的 SHA-256 与加载时间。

2. **可能让机器人运动的指令必须逐次询问**：要求说明部位、目标角/速度/时长、预期运动、风险、停止

方式；沉默、含糊、历史批准都不算批准。CLI 需 `--motion-approved` 与 `ROBAN_STOP_PLAN`，缺一则

`blocked`。

3. **不得自行重启机器人或让关节断电**：禁止 `reboot`/`shutdown`/`killall roslaunch`/`rosnode

kill`/`SetServoLockState*`/`SyncWrite*`/`InstWrite*`/写 offset/改 udev 规则。

4. **所有指令显式且可立即停止**：禁止后台/排队/无限循环运动；明确“断开 SSH 或关闭网页不等于停

止”。

白名单当前只有 `restart-chin-camera`（L2，非运动节点），其前置条件为：BodyHub 不在

`walking/running/error`、`masterID=0`、`/dev/usb_cam` 存在；复测标准为 `/chin_camera/image` ≥ 5 Hz 持

续 5 秒。知识库剧本中的每个 action 必须命中白名单，否则加载时判为无效。

代码层已经实现了与目标 R0–R3 对应的等级雏形：`L0` 只读（读取 offset、复检 offset、拍照测量）、`L1`

本地生成（候选 offset 补丁与 apply 脚本）、`L2` 白名单非运动修复、`L3` 控制读（短暂占用状态机，必须

`controlApproved === true`）。`FORBIDDEN_RULES` 覆盖重启/关机、`killall roslaunch`/`rosnode kill`、

`StateJump`、卸力与扭矩关闭、`SetServoTarPosition`/`SyncWrite`/`InstWrite`、`MotoPosition`/

`HeadPosition`/`jointControl`/`gaitCommand`/`cmd_vel`、写 `offset.yaml`/`dxlInitPose.yaml`/udev/固件；

`MOTION_RULES` 包含中文关键词（上电、卸力、运动、关节、头部、步态、行走、遥控、标定、回

零），需要 `motionApproved === true` **且** `stopPlan` 非空，否则产生 `motion_unapproved` /

`stop_missing` 违规。

<!-- page 10 -->

### RobanLab Doctor 技术调研报告 v1.0 · 第 10 页

### 值得注意的**控制读**例外：为读取实测关节角，允许在 `preReady` + `masterID=0` + 机器人已支撑 + 用户

### 逐次批准的前提下执行一次 `StateJump setStatus → reset`，脚本使用 `trap` 保证退出时 `reset`，并在结束后校

### 验状态回到 `preReady`。

## 5.7 关键技术发现（实机验证的事实）

### 发现

### 含义

### 对系统设计的影响

`GetJointAngle` 返回 `ServoStore.angle`

缓存，仅在进入 `preReady` 时由

`ReadJointValue()` 刷新

软件缓存角不是实测位置

需要“控制读”才能观测手动转动后的变

化；不能把缓存当作反馈

`DirectMethod/GetServoPositionAll` 在

非仿真分支读取 `Present_Position`，且

可能在 `ready` 状态切换 `directOperate`

“Get”不代表只读

接口必须标注 `side_effect_class`；不能

按命名判断权限等级

`/imu/Torso`、SensorHub 温度、

`Status` 等为事件式发布

短窗口无数据不等于故障

检查必须区分“无数据”与“检查失败”，

UNKNOWN 不能升级为 FAIL

温度 0 是无读数

不能判过热

阈值判断只能基于有读数的 ID

电池 `percentage` 恒为 0

驱动未计算

用 voltage 判定（实测 12.2 V）

下巴相机重启后 4–8 分钟复发，

`dmesg` 显示 USB disconnect 与重新枚

举

软件修复只是临时缓解

需要冷却期与“疑似设备侧异常”转人工

## 5.8 测试与验证覆盖

### `workflow/` 中三个 `node:test` 文件共 **38 个测试用例**，覆盖：故障归并、知识库命中与未命中回退、前置

### 条件不满足（BodyHub `walking`）时阻止执行、剧本失败回退、dry-run 不写动作、并行与资源锁串行、

### manual/blocked 单元不入队列、经验写回与 `degraded`、历史日志不算实时故障、冷却期复发保护、白名单

### 校验、标定 delta 计算与 45° 超限阻止、手动转动识别 ID 与歧义判定、控制读逐次批准、症状分类、视觉

### 证据校验、运动动作缺少批准/停止方式被阻止、禁止动作识别、IP 脱敏等。

## 5.9 现状审计：已发现的实现落差与风险

### 在代码审查中发现若干需要在下一阶段修正的落差，它们本身也是本调研报告的价值所在：

### 编号

### 落差

### 影响

### 建议

`L1`

`safety.js` 的禁止/运动正则作

用于**动作名**，而非实际

shell 文本；`ssh-run.run()` 只

重新读取 ATTENTION，不

检查命令内容

若新增动作或模型拼接命

令，可能绕过文本级红线

把审查从“动作名白名单”升

级为“命令模板 + 参数化 +

AST/词法校验”

<!-- page 11 -->

### RobanLab Doctor 技术调研报告 v1.0 · 第 11 页

`L2`

`repair.js` 用 `nohup setsid

roslaunch ... &` 启动相机节

点，与 ATTENTION 规则

4“禁止后台/排队启动”存在

形式张力

后台进程无法用 Ctrl-C 直接

终止，停止依赖 `rosnode

kill` 等未验证手段

改用带看门狗的前台受控进

程，或记录可验证的停止路

径

`L3`

禁止列表中含 `statejump`，

而“控制读”脚本本身包含

``StateJump 99 setStatus →`

reset`，靠

CONTROL_ACTIONS 白名

单放行 + `trap` 兜底

安全依赖“白名单 + 脚本内部

校验”双重机制，缺少形式证

明

把控制读封装为独立、可审

计的原子接口并记录状态前

后快照

`L4`

生成的 `reports/*.md` 中包含

真实机器人 IP

（ATTENTION 仅禁止知识

库存 IP）

隐私与复用风险

报告同样脱敏，连接凭证集

中管理

`L5`

没有真机集成测试；现有测

试用注入状态

`（`fakeActionSequence()`）`

probe 解析、远端脚本、编排

层的真实行为未被覆盖

建立 D01–D15 故障注入回

归集与离线回放

`L6`

无版本控制、无 lockfile、无

CI；`skills/skill.md` 为无关残

留文件

可维护性

初始化 git、清理残留、增加

```text
lint
L7
```

尚未产生任何 `learned-*` 案

例；`calibration/`、

`diagnosis/` 产物目录为空

经验沉淀与标定/视觉流程尚

无真实执行记录

在课程实验中跑通并留存证

据

`L8`

关节 ID 只有 1–22 数字，没

有语义映射与限位表

无法安全做动作级诊断

建立

`robot_profile.joint_map` 并

标注验证状态

## 5.10 现状与目标的差距

<!-- page 12 -->

### RobanLab Doctor 技术调研报告 v1.0 · 第 12 页

差距分析

### 目标模块

### 现有实现

### 差距

### 优先级

Web 工作台（React/Ant

`Design）`

无（CLI + 斜杠命令）

页面、进度推送、diff 审

查、报告展示

```text
P0
FastAPI + WebSocket +
SQLite
```

无（Markdown 报告 +

`JSONL）`

API、任务状态持久化、审计

查询

`P0`

DeepSeek Agent 编排

仅模板 `dsh-analysis-

workflow.js`（解释层）

工具调用闭环、状态机、人

工中断

`P0`

证据数据层 schema

probe 字段较全，但无统一

`evidence` 对象与新鲜度校验

标准化、`validity/freshness/

```text
side_effect_class`
P0
```

规则引擎 YAML

规则硬编码在 JS

可配置、可版本化、按

robot_profile 加载

`P1`

课程知识 RAG

谓词/关键词匹配，5 个种子

案例

文档索引、来源标注、版本

适用性

`P1`

标准运动测试执行器

无（明确禁止运动指令）

用例注册表、机器人端执行

器、停止策略

`P1`

三维预演与回放

无

URDF/模型获取、Three.js 渲

染、三层轨迹对比

`P2`

零位辅助标定

已实现人工在环版本

参考姿态用例、观察表单、

判定输出

`P2`

<!-- page 13 -->

RobanLab Doctor 技术调研报告 v1.0 · 第 13 页

# 6 总体技术方案

总体架构

## 6.1 分层架构

``

**前端层**：React + TypeScript + Vite + Ant Design；Three.js/React Three Fiber（后期）。

``

**后端层**：FastAPI（REST 管理对象，WebSocket/SSE 推送阶段事件与遥测快照），SQLite 存任务、事件、

证据索引。

``

**编排层**：诊断 Workflow（Python 状态机或 LangGraph 状态图）+ DeepSeek Agent。

``

**执行层**：工具网关（参数校验、命令模板、路径白名单、超时、输出限长）+ SSH(Paramiko) + 机器人端适

配器。

``

**知识层**：结构化 robot_profile / 文档索引（FTS5/BM25，后续混合向量） / 案例库。

拟议接口（节选）：

```text
POST /api/robots/connect-check     POST /api/preflight
POST /api/diagnoses                GET  /api/diagnoses/{id}
GET  /api/diagnoses/{id}/evidence  POST /api/diagnoses/{id}/message
POST /api/repairs/{id}/approve     GET  /api/reports/{id}
POST /api/motion-tests/prepare     POST /api/motion-tests/{id}/approve
```

<!-- page 14 -->

### RobanLab Doctor 技术调研报告 v1.0 · 第 14 页

```text
POST /api/motion-tests/{id}/start  POST /api/motion-tests/{id}/cancel
WS   /api/streams/{task_id}
```

### 任务状态机：

```text
created → contextualizing → inspecting → analyzing
→ (awaiting_user | awaiting_approval | repairing | testing)
→ verifying → completed | incomplete | failed | cancelled
```

### 每个任务保存 `robot_id`、`robot_fingerprint`、`experiment_id`、`remote_script`、`run_command_id`、

### `workflow_stage`、`evidence_refs`、`tool_history`、`approval_history`、`fault_hypotheses`、`conclusion`。恢复

### 任务时必须核对机器人身份；不允许用旧审批执行新动作。

## 6.2 诊断主干与条件跳转

诊断主干与分流

### 阶段

### 目的

### 退出条件

S0 上下文

机器人、实验、脚本、运行命令、现象

信息充分或明确缺失

S1 运行环境

解释器版本、依赖、权限、traceback

明确软件缺陷或无

`S2 ROS/BodyHub`

Master、节点、服务、话题、状态、控

制权

环境正常或异常

S3 指令链路

话题、消息结构、参数范围、关节 ID

命令是否被接受

S4 设备观测

位置反馈、力矩、温度、帧更新

反馈是否新鲜可信

<!-- page 15 -->

### RobanLab Doctor 技术调研报告 v1.0 · 第 15 页

S5 标准运动测试

已批准用例 + 人工观察

完成/取消/条件不足

S6 处置与复测

修复或恢复，复测

验证通过或回滚

S7 报告留痕

证据、修改、建议

可导出报告

### 条件跳转规则（示例）：

### 

### 明确 Python SyntaxError → 直接 S6，不做舵机测试；

### 

### ROS Master 不可达 → 禁止任何运动测试（`prohibit_actions: [motion_test_start]`）；

### 

### 软件链路已解释故障 → 不进入 S5；

### 

### 反馈时间戳过期 → 结果 `inconclusive`，不得判“通过”。

### 规则引擎示例（YAML，阈值须来自经过核实的 `robot_profile`）：

```text
rule_id: ros_master_unreachable
when:
all:
```

- field: ros_master.reachable
```text
equals: false
then:
```

finding: "当前 ROS Master 不可用"

```text
category: robot_software
next_workflow: ros_environment
prohibit_actions: [motion_test_start]
evidence_required: [ros_master_check]
```

## 6.3 证据数据层：四类证据不可互替

### 统一证据对象字段：

```text
{
"evidence_id": "ev-003",
"diagnosis_id": "diag-001",
"robot_id": "lemon-nuc8i3beh",
"source_type": "servo_position_direct_read",
```

<!-- page 16 -->

### RobanLab Doctor 技术调研报告 v1.0 · 第 16 页

```text
"source_interface": "/MediumSize/BodyHub/DirectMethod/GetServoPositionAll",
"joint_id": 14,
"observed_at_robot": "2026-11-25T18:12:03+08:00",
"received_at_server": "2026-11-25T18:12:05+08:00",
"value": 11.8, "unit": "deg",
"validity": "valid", "freshness": "fresh",
"side_effect_class": "requires_verified_state_handling",
"raw_ref": "artifact://raw/ev-003.json",
```

"note": "采集失败时写 null/unknown，不允许模型补齐"

`}`

### 证据层

### 含义

### 诊断边界

① 平台命令/目标角

平台或脚本发出的目标

发出 ≠ 控制器接受

② 控制器软件状态

BodyHub 状态、控制权、缓存角

缓存 ≠ 真实电机位置

③ 电机侧反馈

编码器角、力矩使能、温度

编码器变化 ≠ 机械输出位移

④ 外部物理观察

是否移动、是否下垂、异响

主观观察需保留不确定性

### 关节诊断快照 `JointDiagnosticSnapshot` 包含 `commanded_target_deg`、`command_received(true|false|

### unknown)`、`cached_joint_angle_deg`、`motor_position_deg`、`torque_enabled`、`motor_temperature_c`，以及

### optional 的 `voltage_v`/`current_a`/`hardware_fault_code`（当前实机未验证，缺省为 unknown）。时间戳不

### 等于时钟同步，跨设备对比需单调时间源或对齐策略。

## 6.4 安全与权限分级

### 级别

### 范围

### 执行方式

`R0`

经验证的只读检查

自动执行并记录

`R1`

白名单目录内的学生代码修复（备份 +

diff + 语法检查）

受控自动，按策略可再确认

`R2`

系统级变更（重启关键节点、改启动配

置）

展示变更 + 用户明确批准 + 回滚

`R3`

物理动作 / 力矩 / 零偏写入

标准用例 + 逐次现场确认 + 设备侧停

止机制

<!-- page 17 -->

RobanLab Doctor 技术调研报告 v1.0 · 第 17 页

关键原则：**接口是否属于 R0 不能按“Get”字样判断**。已有源码显示某些位置读取服务可能引发 BodyHub

状态切换，因此每个接口必须标注 `read_only_verified / state_affecting / motion_affecting / unknown`，后两类

不能被普通 Agent 当作自由只读工具。

复测判定必须区分四个层级：

语法修复成功   ≠ 程序逻辑正确

程序启动成功   ≠ ROS 消息被正常接收

命令发送成功   ≠ 控制器接受

控制器接受     ≠ 机器人实际动作完成

审计字段：机器人 ID、实验 ID、源文件哈希、前后 diff、备份引用、执行者角色、时间、审批结果、运行命

令 ID、工具输出、复测标准。管理员可查看被拒绝的请求。

## 6.5 知识库与 RAG

索引管线七步：收集登记（原路径、哈希、版本、来源，区分厂家原版/备份修改版/学生记录）→ 解析

（Markdown 标题、PDF 页码、Python 函数、YAML 键路径）→ 语义/代码边界分块（不拆散服务名与实现

体，保留行号/页码）→ 关键词索引（精确术语如 `GetServoPositionAll`、`StateJump`、`offset.yaml`、

`ttyUSB0`）→ 可选语义索引（Embedding + FAISS/Chroma，需验证是否优于关键词）→ 排序（BM25 + 语

义，优先匹配当前型号与版本）→ 来源验证（输出原文片段、文件、行号、版本、验证状态）。

可信度优先级：**当前实机状态 > 与当前版本匹配源码/厂家文档 > 本地备份与历史记录 > 无法匹配时显式

列出冲突与待验证事项**。未核对字段必须为 `null`/`unverified`，不能伪造行号。

## 6.6 标准运动测试与三维预演

用例命名：`SJ-01…SJ-22`（每个电机基础状态检查与未来的单轴运动）、`AX-*`（单逻辑自由度正/反/保

持）、`CP-*`（多关节复合）、`RP-*`（参考姿态）、`LG-*`（批准吊挂工况腿部动作）、`EX-*`（课程实验

关联）。状态闸门：

`draft → mapping_checked → simulation_checked → hardware_approved → enabled`

（另有 suspended / retired / needs_revalidation）

<!-- page 18 -->

### RobanLab Doctor 技术调研报告 v1.0 · 第 18 页

### 执行序列：准备（机器人指纹、轨迹版本、真实起始状态）→ 三维预演 → 环境准入（在场、支撑、净空、

### 控制权、遥测新鲜度）→ 用户审批（一次性、绑定用例与轨迹版本）→ **重新读取起始状态**（不一致则撤

### 销审批）→ 机器人本机执行（已验收轨迹与限速，独立监控与停止）→ 采集 → 评估与报告。

### 误差定义：`e_i(t) = q_{i,target}(t) − q_{i,feedback}(t)`，可计算末端误差、最大误差、RMSE、保持漂移、返

### 回偏差、响应延迟；结论分为 `pass / abnormal / inconclusive / aborted`，其中 `pass` 不等于“电机完全健

### 康”。

### **腿部悬空测试边界**：日常悬挂存放不等于该吊具已批准承受动态运动测试负载。必须先满足教师批准、

### 吊挂点与固定方式现场核验、净空与线缆安全、现场监护与独立停止能力，且轨迹适配悬空工况。第一版禁

### 止悬空状态下的行走/步态测试。悬空测试能说明单轴运动与反馈、无地面接触的动作协调性、与参考姿态

### 的差异；不能说明站立负载能力、落地步态、精密零偏或抗跌倒能力。

## 6.7 零位辅助检查

### 软件角度与编码器无法独立证明机械零位正确。系统只支持：检索零位文档与已加载偏移配置；展示读数、

### 参考姿态与人工观察的不一致；给出“未发现明显偏移 / 疑似偏移 / 无法判断”三态结论；建议停止实验、换

### 机或联系教师。**默认禁止自动写入 `offset.yaml` 或自动解除力矩**（现有半成品已实现该边界：生成候选补

### 丁与 apply 脚本，由用户手动执行并手动重启 BodyHub）。

### 人工观察表单字段：`actual_motion`、`pose_matches_reference`、`deviation_direction`、`visible_slip_or_sag`、

### `abnormal_sound`、`measurement_method`、`observation_notes`（保留用户原话）、`photo_video_ref`。

## 6.8 机器人端适配器与接口清单

### 接口

### 用途

### 副作用

### 状态

```text
`/MediumSize/BodyHub/
GetStatus`
```

控制状态

需核对版本

已实测

```text
`/MediumSize/BodyHub/
GetMasterID`
```

当前控制 ID

需核对状态转换约束

已实测

```text
`/MediumSize/BodyHub/
GetJointAngle`
```

软件缓存角

缓存非实测

已实测

```text
`/MediumSize/BodyHub/
ScanServo`
```

在线舵机扫描

仅 `preReady`

已实测

```text
`/MediumSize/BodyHub/
PresentTemperature`
```

舵机温度

部分 ID 无读数

已实测

```text
`/MediumSize/BodyHub/
DirectMethod/
GetServoPositionAll`
```

电机反馈位置

可能切换 `directOperate`

源码线索，待验证

<!-- page 19 -->

### RobanLab Doctor 技术调研报告 v1.0 · 第 19 页

```text
`/MediumSize/BodyHub/
DirectMethod/
GetServoLockStateAll`
```

力矩锁定状态

需实测核验

待验证

```text
`/MediumSize/BodyHub/
StateJump`
```

状态机切换

有副作用，必须受限

已实现受控控制读

```text
`/MediumSize/BodyHub/
jointControl`、
`MotoPosition`、
`HeadPosition`
```

关节/头部动作

物理动作

当前禁止

### 产物：`robot_profile`、`interface_manifest`、`joint_map`、`motion_capability_matrix`、`tested_stop_strategy`，

### 每项均带证据来源。关节映射：1–12 身体舵机部分（逐 ID 解剖学名称待核对）、13/14/15 右臂、16/17/18

### 左臂、19/20 左右夹爪、21/22 头部；不得把 13 直接命名为“肩前举”、14 直接命名为“侧平举”。

# 7 关键技术问题与创新点

### 1. **证据语义边界的形式化**：把“命令角/缓存角/编码器反馈/物理观察”作为一等公民建模，并在规则引擎

### 中禁止跨层推断。这是本项目区别于一般代码调试 Agent 的核心。

### 2. **固定工作流 + 规则引擎 + Agent 的三权分立**：Workflow 保证顺序与停机条件，Rule 保证明确判断，

### Tool 保证执行，Policy 保证安全，RAG 提供知识，Agent 负责理解与解释。模型不能绕过闸门。

### 3. **接口副作用标注**：把“读取是否安全”作为元数据（`side_effect_class`），避免“Get 就是只读”的误判。

### 4. **经验闭环与复发保护**：知识库匹配 → 修复 → 复测 → 写回统计 → 连续失败标记 `degraded` → 冷却期

### 内复发自动阻止重试并转人工。这把“自动修复”与“反复重启掩盖硬件问题”区分开。

### 5. **诊断边界的显式承认**：在缺乏电流/电压/故障码/输出轴位置时，系统输出“疑似设备侧异常 + 换机建

### 议 + 缺失证据清单”，而非虚假的硬件结论。

### 6. **物理安全优先的扩展路线**：运动测试用例从 `draft` 到 `hardware_approved` 的状态闸门，使“22 个关节

### 覆盖”成为可验证的工程目标，而非展示数字。

<!-- page 20 -->

### RobanLab Doctor 技术调研报告 v1.0 · 第 20 页

# 8 实验设计与评价指标

## 8.1 故障测试集 D01–D15

### 编号

### 场景

### 期望系统行为

### 测试方式

`D01`

Python 语法/导入错误

明确归为 student_software，

备份+补丁+复测

可控注入

`D02`

路径/依赖错误

定位并修复，复测通过

可控注入

`D03`

ROS Master 不可用

禁止运动测试，报告环境异

常

隔离环境/仿真

`D04`

BodyHub 节点缺失

不继续发送运动命令

只读

`D05`

话题/消息类型错误

定位指令链路问题

可控注入

`D06`

控制权冲突

阻止运动，保留状态证据

只读

`D07`

参数超出已验证限制

拒绝动作

离线校验

`D08`

反馈采样过期/丢失

结果 `inconclusive`，不得判

通过

数据回放

`D09`

标准用例反馈异常

归为疑似设备侧，建议换机

已验证用例

`D10`

编码器正常但人工观察不符

疑似映射/传动/零位异常

人工在环

`D11`

运动审批缺失/过期

严格拒绝实机运动

自动化负向测试

`D12`

机器人或用例版本更换

撤销旧审批与旧测试有效性

自动化

`D13`

SSH 在运动中断开

机器人端独立已验证停止并

记录

先仿真，实机需教师指导

`D14`

腿部用例无吊挂批准

仅预览/只读

自动化负向测试

`D15`

另一台机器人运行正常

不能直接断言硬件损坏

双机信息对比

### 禁止为获取故障样本故意损坏电机、制造失稳、修改危险限位或人为卡滞负载。

## 8.2 评价指标

### 指标

### 定义

### 目标

分流准确率

归因类别与标注一致的比例

≥ 80%（初始 8–12 例）

不当硬件确诊率

把“疑似”断言为“损坏”的次数

趋近 0

软件修复成功率

修复且复测符合预设标准

`≥ 70%`

无关修改率

改动无关代码或使状态变差

`≤ 5%`

证据完整率

报告含工具结果、时间、来源、前后

```text
diff
100%
```

安全策略拒绝率

危险请求被拒绝的比例

`100%`

动作覆盖率

已验收主动测试电机数 / 22

分阶段递增，待验收单独列出

可重复性

同一用例多次执行结果一致

高

<!-- page 21 -->

### RobanLab Doctor 技术调研报告 v1.0 · 第 21 页

### 推荐课程演示脚本（8 步）：输入 IP → 一键预检 → 注入可控代码错误让 Agent 定位/备份/补丁/复测 → “程

### 序正常但关节不动”情景 → Agent 推荐已批准上肢/头部用例并展示三维理想轨迹 → 学生现场确认执行并展

### 示反馈曲线与人工观察 → Agent 输出三类结论报告 → 若无批准吊挂条件则演示三维预览与系统拒绝逻辑。

# 9 实施路线与里程碑

### 里程碑

### 主要工作

### 关卡

### 现状

M0 能力核对

实机版本、接口副作用、关

节映射、停止策略

不能按历史代码猜测安全限

制

部分完成

M1 连接与预检

SSH + probe + selfcheck + 报

告

路径限制与认证有效

基本完成（缺 Web）

M2 确定性诊断

分层规则与故障归并

缺数据必须标记未知

基本完成

M3 Agent 与修复

DeepSeek 工具调用、状态

机、备份/复测

不能执行任意 shell/任意运动

部分完成

M4 课程知识

文档索引、来源标注、实验

画像

历史资料不冒充实机事实

部分完成（无 RAG）

M5 运动测试 V1

用例注册表、3D 预演、本机

执行器

审批/停止/起始姿态/质量评

估通过

未启动

M6 诊断融合

Agent 推荐用例、等待确

认、分析观察

Agent 不能绕过物理确认

部分完成

M7 扩展与验收

复合动作、参考姿态、回归

测试

未批准吊挂绝不启动腿部运

动

未启动

### 建议先完成 M0–M3，再并行推进知识库与三维预览；M5 以稳定可验证的停止机制与控制权为前提。若时间

### 不足，优先保证诊断真实性与安全性，而非三维界面的完整外观。

## 9.1 风险与缓解

### 风险

### 影响

### 缓解

实机接口与备份源码不一致

误判安全边界

每个接口必须实测并标注验证状态

运动执行器无法在断网时安全停止

物理伤害

机器人端独立执行器 + 经验证停止策略

+ 硬件急停

关节映射/限位未验证

碰撞或超限

用例状态闸门；未验证用例不可执行

知识库把旧资料当作当前事实

错误归因

版本/适用性元数据 + 可信度优先级

自动修复掩盖硬件问题

设备损坏

冷却期、复发计数、degraded 标记、转

人工

<!-- page 22 -->

RobanLab Doctor 技术调研报告 v1.0 · 第 22 页

大模型越权调用工具

安全事故

后端不可绕过 Policy，审批令牌一次

性、绑定任务与机器人

时间不足

交付不完整

P0 优先，P2 作为可裁剪扩展

# 10 预期成果

1. 可运行的 Web 软件（学生端浏览器工作台）。
2. 机器人端兼容适配器，附当前支持的 ROS/BodyHub 版本与接口副作用清单。
3. 诊断 Workflow + 规则引擎 + DeepSeek Agent + 安全网关 + 审计日志。
4. 带版本与来源标注的课程知识库与检索测试集。
5. 标准运动测试用例库（状态、轨迹版本、三维参考、反馈数据、验收状态）。
6. 测试与演示资料：录屏、可复现故障案例、设计文档与安装手册。
# 11 结论

RobanLab Doctor 的定位不是“给大模型一个 SSH 终端”，而是**让大模型在经验证的工具、固定的工作流和

不可绕过的权限分级内，把实验失败转化为有证据、有边界、可复测的诊断结论**。现有半成品已经证明了

这一路径的可行性：它实现了只读证据采集、规则化归并、知识库驱动的受控修复、复测与经验回写，并在

真实机器人上观察到“修复成功—复发—自动转人工”的典型闭环；同时它也暴露了关键约束——缓存角不等

于实测位置、无读数不等于零、断开 SSH 不等于安全停止。

后续工作的重心应是把这套确定性内核扩展为完整的课程平台：Web 交互、FastAPI 任务与证据存储、真正

的 RAG 知识检索、以及以安全准入为前提的标准运动测试与三维预演。在关节映射、机械限位、吊挂工况

审批与停止策略未经验证之前，应缩小已开放的运动测试范围，而不是降低准入条件去追求“22/22”的展示数

字。

# 参考文献

1. DeepSeek API Docs — Messages API（tool_calls）：https://api-docs.deepseek.com/api/create-message/

<!-- page 23 -->

RobanLab Doctor 技术调研报告 v1.0 · 第 23 页

2. LangChain / LangGraph — Human-in-the-loop（interrupt）：https://docs.langchain.com/oss/javascript/
`langchain/human-in-the-loop`

3. Gao et al., "Retrieval-Augmented Generation for Large Language Models: A Survey", arXiv:2312.10997.
4. RoSHA: A Multi-robot Self-healing Architecture, Springer (2014):
`https://rd.springer.com/content/pdf/10.1007/978-3-662-44468-9_27.pdf`

5. ROS 1 Wiki — rosnode / rostopic / rosservice 命令：https://wiki.ros.org/
6. CoppeliaSim Manual — Import/export
`（URDF）：https://manual.coppeliarobotics.com/en/importExport.htm#urdf`

7. Paramiko — SSH for Python：https://paramiko-docs.readthedocs.io/
8. SQLite Full-Text Search (FTS5)：https://www.sqlite.org/fts5.html
9. 项目内部资料：《RobanLab_Doctor_项目方案总结》(2026-11-20)、《RobanLab_Doctor_模块化方案 v1.0》

(2026-11-22，11 个模块文档)。

10. 现有代码与实测记录：`final/ATTENTION/ATTENTION.md`、`final/agent/README.md`、`final/kb/

README.md`、`final/reports/roban-rca-2026-11-19T02-57-00.md`、`final/kb/events.jsonl`、《智能交互机器人

实验 6 Roban 仿真环境 CoppeliaSim 2026》(39 页课件)。
