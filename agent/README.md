# Roban 故障自检 / 自动修复 Agent（供 deepseek harness 使用）

> 日常使用请看 **[使用手册 USAGE.md](USAGE.md)**；本文是技术说明（结构、阶段、安全边界）。

本目录把「连接机器人 → 只读证据采集 → 规则自检 → 归因 → 知识库检索 → 并行修复（知识库优先，失败自行尝试）→ 复检 → 经验回写 → 报告」固定成一套可执行的 JS workflow + skills。结构与 `dlp-harness-workflow` 一致：零 npm 依赖，每个 skill 都是同构模块，workflow 只依赖一个 `ctx` 适配对象。

## 零、执行前的强制安全审查

**每次执行任何机器人操作之前，必须先完整读取 [`ATTENTION/ATTENTION.md`](../ATTENTION/ATTENTION.md)。**
如果文件缺失、为空或无法读取，必须停止，不得执行任何机器人操作。

四条硬规则：

1. **知识库不得记录机器人 IP**：`kb/cases/*.json`、`kb/events.jsonl`、学习案例、证据快照都不写 IP；
   读取知识库时也不采用其中的 IP/主机地址。当前 IP 只能来自用户在当前对话中的明确输入。
2. **可能让机器人运动的指令必须逐次询问用户**：说明动作、范围、速度、时长、风险和停止方式，
   得到“确认/执行/同意”后才运行；上次批准不算本次批准。
3. **不得自行重启机器人或让关节断电/卸力**：禁止 `reboot`/`shutdown`、`killall roslaunch`、
   重启 BodyHub/roscore、`SetServoLockState*` 卸力、写舵机寄存器等；只能建议用户手动处理。
4. **所有指令必须显式、可立即停止**：禁止后台/排队运动；运动前必须告诉用户如何立刻停止
   （硬件急停/断电、终端 Ctrl-C；关闭网页或断开 SSH 不等于停止）。

代码层由 [`skills/safety.js`](../skills/safety.js) 在每次审查时重新读取 ATTENTION，并在
workflow、`repair`、`repair-parallel` 和知识库读写处强制执行。

```text
final/
├── ATTENTION/ATTENTION.md          # 最高优先级安全规则，每次执行前必读
├── agent/README.md                 # 本文：结构、用法、安全边界
├── .dsh/                           # dsh 项目级集成
│   ├── skills/roban-auto-repair/   #   技能（SKILL.md）
│   └── commands/roban-detect.md    #   斜杠命令 /roban-detect
│   └── commands/roban-workflow.md  #   斜杠命令 /roban-workflow
│   └── commands/roban-calibrate.md #   斜杠命令 /roban-calibrate
│   └── commands/roban-calibrate-motion.md # 斜杠命令 /roban-calibrate-motion
│   └── commands/roban-visual-diagnosis.md # 斜杠命令 /roban-visual-diagnosis
├── kb/                             # 本地经验知识库（见 kb/README.md）
│   ├── cases/*.json                #   一条经验一个文件（seed / learned）
│   └── events.jsonl                #   只追加的修复尝试审计日志
├── workflow/
│   ├── workflow.js                 # 两个任务：roban-selfcheck / roban-auto-repair
│   ├── calibration-workflow.js     # 零位标定：人工在环 + 手机测量
│   ├── harness-adapter.example.js  # ctx 适配 + 本地 CLI
│   ├── calibrate-adapter.js        # 零位标定 CLI
│   ├── joint-identify-adapter.js   # 手动转动识别关节 ID CLI
│   ├── general-diagnosis-workflow.js # 泛用视觉诊断 workflow
│   ├── visual-diagnosis-adapter.js # 泛用视觉诊断 CLI
│   ├── auto-repair.test.js         # node:test 覆盖并行/知识库/回退/学习
│   └── safety.test.js              # node:test 覆盖 ATTENTION/IP/运动门禁
├── skills/
│   ├── index.js                    # skill 注册表
│   ├── safety.js                   # ATTENTION 读取、动作审查、IP 脱敏
│   ├── ssh-run.js                  # SSH 执行（密钥认证）
│   ├── env-probe.js                # 只读基线探测
│   ├── selfcheck.js                # 规则化检查项
│   ├── diagnose.js                 # 归因、候选原因、修复候选
│   ├── symptom-intake.js           # 自然语言故障描述结构化
│   ├── visual-evidence.js          # 图片/手机 capture + 视觉 observations 校验
│   ├── general-hypothesis.js       # 描述 + 视觉 + 软件证据归因
│   ├── general-report.js           # 泛用诊断报告
│   ├── joint-positions.js          # 控制读：刷新并读取 22 个实测关节角
│   ├── joint-identify.js           # baseline/diff/zero：手动转动识别 ID
│   ├── calibration-plan.js         # 零位标定规划（人工步骤/风险分级）
│   ├── calibration-measure.js      # 人工/手机测量 → delta
│   ├── calibration-offset.js       # 读取 offset → 候选值/备份/patch/apply 脚本
│   ├── calibration-verify.js       # apply 后复检 offset
│   ├── calibration-report.js       # 零位标定记录
│   ├── repair.js                   # 白名单修复动作（默认 dry-run）
│   ├── verify.js                   # 修复后复检
│   ├── fault-units.js              # 故障分组：检查项 → 组件修复单元
│   ├── kb.js                       # 知识库读写：匹配 / 计划 / 经验回写
│   ├── repair-plan.js              # 规划阶段：KB 优先 + 自行尝试阶梯
│   ├── repair-parallel.js          # 并行执行：并发上限 + 资源锁 + 失败回退
│   ├── learn.js                    # 经验写回知识库
│   └── report.js                   # Markdown 报告
├── tools/
│   └── phone-camera/               # 手机相机测量页（零依赖本地 HTTP 服务）
├── diagnosis/                      # 泛用视觉诊断产物（见 diagnosis/README.md）
│   ├── images/                     #   现场图片
│   ├── vision-observations.json    #   视觉模型看图后的结构化观察
│   └── reports/                    #   诊断报告
├── calibration/                    # 零位标定产物（见 calibration/README.md）
│   ├── captures/                   #   手机照片 + 测量 JSON
│   ├── backups/                    #   原始 offset 备份
│   ├── patches/                    #   候选 offset 补丁
│   ├── scripts/                    #   人工 apply 脚本（agent 不执行）
│   └── reports/                    #   标定记录
├── templates/
│   ├── probe.sh                    # 远端只读探测脚本
│   ├── vision-observations.example.json # 视觉观察 schema 示例
│   └── dsh-analysis-workflow.js    # dsh LLM 分析层模板
└── reports/                        # 生成的报告
```

## 一、快速开始

前提：本机能免密 SSH 到机器人。

```bash
ssh lemon@<ROBOT_IP> hostname
```

只读自检 + 归因（不修复）：

```bash
cd final
ROBAN_HOST=<ROBOT_IP> node workflow/harness-adapter.example.js selfcheck
```

完整自动修复流程（**dry-run**，不动机器人、不写知识库）：

```bash
ROBAN_HOST=<ROBOT_IP> node workflow/harness-adapter.example.js auto
```

真正执行修复并写知识库（会先检查 BodyHub 状态、控制者、设备）：

```bash
ROBAN_HOST=<ROBOT_IP> node workflow/harness-adapter.example.js auto --confirm
```

只跑到规划阶段、查看知识库命中情况：

```bash
ROBAN_HOST=<ROBOT_IP> node workflow/harness-adapter.example.js plan
```

IP 必须由用户在当前对话中给出；不要从知识库、历史会话（例如 `session.md`）或报告里取。

跑测试（不需要机器人）：

```bash
node --test workflow/auto-repair.test.js
```

报告写入 `final/reports/roban-selfcheck-<timestamp>.md`。可用模式：
`probe | selfcheck | diagnose | all`（旧流程），`plan | repair | verify | auto`（自动流程）。
知识库目录用 `ROBAN_KB_DIR` 覆盖，修复并发用 `ROBAN_REPAIR_CONCURRENCY`（默认 3）。

## 二、知识库（KB）

完整 schema / 匹配 / 写入规则见 [`kb/README.md`](../kb/README.md)。要点：

- **只存经验，不存命令**：案例里的 `playbook[].action` 必须命中 `repair.js` 的白名单，加载时校验，未授权动作直接判为无效。
- **匹配**：组件必须相同 + 签名谓词全部成立，再按「检查项重合度 / 关键词」打分。
- **决策**：命中且 `autoRepairable` 且前置条件成立 → 按知识库剧本修；未命中 / 经验 degraded / 剧本失败 → 自行尝试安全阶梯。
- **写入**：只有 `--confirm` 的真实执行才写。成功更新 `stats.successes`；失败累计 failures，连续失败 ≥2 次标记 `degraded`（下次跳过该经验）；自行尝试成功则生成 `learned-*` 新案例。
- **复检优先于自报**：动作自报成功但整体复检仍失败，记为无效，不增加成功数。
- **复发保护**：案例可配置 `cooldownMs`；修复成功后冷却期内同故障再次出现，计划直接 `blocked`，
  记录 `recurrence` 事件并转人工，避免「重启—再掉—再重启」的循环。

种子经验（来自 2026-11-19 实测）：

| 案例 | 组件 | 自动 | 说明 |
|---|---|---|---|
| `camera-chin-startup-order` | camera.chin | 是 | 下巴相机节点启动竞态，重启非运动节点 |
| `servo-bus-intermittent-reads` | servo.bus | 否 | dxlBulkRead 间歇错误，查供电/线缆/接头 |
| `servo-temperature-zero-readings` | servo.temperature | 否 | 温度 0 是无读数，不是 0°C |
| `sensor-imu-no-data` | sensor.imu | 否 | 事件式/未接入，不判故障 |
| `sensor-sensorhub-no-data` | sensor.sensorhub | 否 | 低频发布，延长窗口确认 |

## 三、skill 契约

```js
module.exports = {
  id, title, description, inputs,
  async run(ctx, input) { ... }
}
```

`ctx` 由 harness 注入：

```js
const ctx = {
  log(msg, data),
  fs,                       // Node fs
  exec(file, args, opts),   // 本地命令
  remote: { host, user, port, proxy? },
  reportDir,                // 报告目录
  kbDir                     // 知识库目录
};
```

| skill | 输入 | 输出 | 读/写 |
|---|---|---|---|
| `safety` | `{actions, motionApproved, stopPlan}` | 规则 SHA-256、动作分类、违规、停止说明 | 只读规则 |
| `ssh-run` | `{command, input?, timeoutMs?}` | `{code, stdout, stderr}` | 取决于命令 |
| `env-probe` | `{scan=true}` | `probe` 结构化基线 | 只读 |
| `selfcheck` | `{probe}` | `checks[]` + `summary` | 只读 |
| `diagnose` | `{probe, checks}` | `findings / hypotheses / repairCandidates / needsUserInput` | 只读 |
| `symptom-intake` | `{description, part?, errorText?, hasImages?}` | 标签 / 风险 / 补问 | 只读 |
| `visual-evidence` | `{images, captures, visionObservations?}` | 图片元数据 / 视觉提示 / 缺失项 | 只读 |
| `general-hypothesis` | `{symptom, visualEvidence, probe?, checks?}` | 候选原因 / 安全动作 / 推荐 workflow | 只读 |
| `general-report` | `{symptom, visualEvidence, generalDiagnosis, ...}` | Markdown 报告 | 只写本地 |
| `joint-positions` | `{controlApproved}` | 刷新后的 22 个实测角 + 状态机前后状态 | 控制读 |
| `joint-identify` | `{phase, controlApproved, jointId?, expectedZero?}` | 基线/识别候选/零点角度 | 控制读 |
| `calibration-plan` | `{jointId, layer, expectedAngle, actualAngle?, captureFile?}` | 标定计划 / 风险 / 人工步骤 | 只读 |
| `calibration-measure` | `{jointId, expectedAngle, actualAngle?, captureFile?}` | `delta / source` | 只读 |
| `calibration-offset` | `{jointId, layer, delta, sign}` | 候选 offset / 备份 / patch / apply 脚本 | 只读机器人 + 写本地 |
| `calibration-verify` | `{jointId, layer, expectedOffset}` | 当前 offset / 是否匹配 | 只读 |
| `calibration-report` | `{plan, measurement, offset, verify?}` | Markdown 标定记录 | 只写本地 |
| `repair-plan` | `{probe, checks, findings, repairCandidates, kbDir?}` | `units / plans / kbLookups / planSummary` | 只读知识库 |
| `repair-parallel` | `{plans, confirm=false, concurrency?}` | `repairParallel{outcomes, summary, maxConcurrency}` | 默认 dry-run |
| `learn` | `{outcomes, verify, probe, confirm, kbDir?}` | `kbWrite` | 只写本地知识库 |
| `repair` | `{action, confirm=false}` | `{status, before, after, verification}` | 单动作，默认 dry-run |
| `verify` | `{beforeChecks, scan, targets}` | 状态变化 + 是否通过 | 只读 |
| `report` | 上述结果 + `auto` | Markdown + 文件路径 | 只写本地报告 |

辅助模块（非 skill）：`fault-units.js`（组件归并/自动修复分类）、`kb.js`（知识库读写）。

## 四、workflow 阶段

### 任务 A：`roban-selfcheck`（旧流程，保持兼容）

| # | 阶段 | 使用的 skill | 说明 |
|---|---|---|---|
| 1 | `safety` | `safety` | 读取 ATTENTION，建立本次安全审查上下文 |
| 2 | `probe` | `env-probe` | 主机、ROS、BodyHub、舵机、传感器、日志 |
| 3 | `selfcheck` | `selfcheck` | 规则判定，产出 ok/warn/fail/unknown |
| 4 | `diagnose` | `diagnose` | 归因、候选原因、白名单修复候选 |
| 5 | `safety-review` | `safety` | 修复前审查动作：禁止/未授权/运动未批准会阻止执行 |
| 6 | `repair` | `repair` | 默认 dry-run；`state.confirmRepair=true` 且安全审查通过才执行 |
| 7 | `verify` | `verify` | 仅在 repair 成功后运行 |
| 8 | `report` | `report` | 生成 Markdown 报告（含安全审查章节） |

### 任务 B：`roban-auto-repair`（检测 → 知识库 → 并行修复 → 学习）

| # | 阶段 | 使用的 skill | 说明 |
|---|---|---|---|
| 1 | `safety` | `safety` | 读取 ATTENTION，建立本次安全审查上下文 |
| 2 | `probe` | `env-probe` | 连接机器人 + 只读基线 |
| 3 | `selfcheck` | `selfcheck` | 初始检测 |
| 4 | `diagnose` | `diagnose` | 初始归因 |
| 5 | `plan` | `repair-plan` | 故障分组（同根因合并）+ 知识库检索 + 计划 |
| 6 | `safety-review` | `safety` | 审查知识库/自行尝试动作；禁止动作直接阻止 |
| 7 | `repair` | `repair-parallel` | 各单元并行执行；KB 优先，失败自行尝试；安全审查通过才执行 |
| 8 | `verify` | `verify` | 重新采集证据，整体复检并对比 |
| 9 | `learn` | `learn` | 成功/失败经验写回知识库（自动 IP 脱敏） |
| 10 | `report` | `report` | 报告含安全审查、知识库命中、并行修复、KB 更新 |

### 任务 C：`roban-zero-calibration`（人工在环，解决软件读不出的零点偏移）

**能力边界**：软件只能读到缓存角/指令角，读不到真实机械零位；单目手机也不能直接给出可靠的绝对零位。
因此这条 workflow 是“人工测量 + 自动计算 + 生成补丁”，不是无人值守自动修：

| # | 阶段 | 使用的 skill | 说明 |
|---|---|---|---|
| 1 | `safety` | `safety` | 读取 ATTENTION；确认不做运动/重启/断电 |
| 2 | `plan` | `calibration-plan` | 关节、offset 层、期望/实际角度、风险分级、人工步骤 |
| 3 | `measure` | `calibration-measure` | 人工角度或手机 capture JSON → delta |
| 4 | `prepare` | `calibration-offset` | 读取当前 offset → 候选值、备份、patch、apply 脚本 |
| 5 | `verify` | `calibration-verify` | 用户手动 apply + 手动重启后，只读比对 offset |
| 6 | `report` | `calibration-report` | 标定记录、文件路径、人工 apply/复检步骤 |

明确不做：自动写 `offset.yaml`、自动重启 BodyHub、自动上电/卸力/运动。apply 脚本必须由用户手动运行。

```bash
# 人工测角 → 生成候选 offset / 补丁 / apply 脚本
ROBAN_HOST=<ROBOT_IP> node workflow/calibrate-adapter.js calibrate \
  --joint 7 --layer pose --expected-angle 0 --actual-angle 3.2 --sign 1

# 手机测量页（手机和 Mac 同一 Wi-Fi）
node tools/phone-camera/server.js
# 用生成的 calibration/captures/capture-*.json 作为 --capture 输入

# 用户手动运行 calibration/scripts/apply-offset-*.sh 并手动重启 BodyHub 后：
ROBAN_HOST=<ROBOT_IP> node workflow/calibrate-adapter.js calibrate-verify \
  --joint 7 --expected-offset 8.2
```

手机页面只做人工测量辅助：手机要固定、画面要有基座参考线；手持单张照片不能当绝对零位真值。
更多说明见 [`calibration/README.md`](../calibration/README.md)。

### 任务 D：手动转动识别关节 ID（不知道 ID 时先走这一步）

`GetJointAngle` 返回的是 `ServoStore.angle` 缓存，只在 BodyHub 进入 `preReady` 时由
`ReadJointValue()` 刷新。手动转动关节后，必须先做一次 `StateJump setStatus → reset`
的“控制读”，再读 `GetJointAngle` 才能看到实测变化。

```bash
# 1) 基线：读取 22 个关节（用户批准控制读）
ROBAN_HOST=<ROBOT_IP> node workflow/joint-identify-adapter.js baseline --control-approved

# 2) 用户手动大幅转动一个关节后，识别 ID
ROBAN_HOST=<ROBOT_IP> node workflow/joint-identify-adapter.js diff --control-approved

# 3) 用户把该关节手动放到正确零点后，读取软件角度
ROBAN_HOST=<ROBOT_IP> node workflow/joint-identify-adapter.js zero --joint 7 --control-approved

# 4) 把 zeroAngle 作为实际角度，生成候选 offset（sign=-1）
ROBAN_HOST=<ROBOT_IP> node workflow/calibrate-adapter.js calibrate \
  --joint 7 --expected-angle 0 --actual-angle <zeroAngle> --sign -1
```

控制读的安全条件：

- 机器人已支撑，`preReady`，`masterID=0`；
- 用户逐次批准 `--control-approved`；
- 只做 `StateJump 99 setStatus` → `reset`，不运动、不改扭矩；
- 脚本 `trap` 确保退出时 reset，并检查 `masterID=0` / 状态回到 `preReady`；
- 失败或无法释放状态机时立即停止，不继续标定。

识别逻辑：`diff` 比较前后 22 个角度，变化最大的关节为候选；如果第二名变化超过第一名的 60%，
判为 `ambiguous`，要求只转一个关节或重新 baseline，不猜 ID。

### 任务 E：`roban-general-diagnosis`（视觉 + 自然语言泛用诊断）

适用于“症状说不清、关节 ID 也不知道、可能是硬件/软件混合”的情况。模型具备视觉能力时，
由 **agent 看图** 并填写 structured `visionObservations`；workflow 只做归因、证据合并和安全动作筛选，
不假装自己能看图。

| # | 阶段 | 使用的 skill | 说明 |
|---|---|---|---|
| 1 | `safety` | `safety` | 读取 ATTENTION；红线优先 |
| 2 | `intake` | `symptom-intake` | 部位/症状标签、风险、补问 |
| 3 | `visual` | `visual-evidence` | 图片/capture 校验、视觉 prompt/observations |
| 4 | `probe` | `env-probe` | 有机器人连接时做只读基线 |
| 5 | `selfcheck` | `selfcheck` | 只读软件证据 |
| 6 | `hypotheses` | `general-hypothesis` | 描述 + 视觉 + 软件证据 → 候选原因 |
| 7 | `safety-review` | `safety` | 审查白名单动作 |
| 8 | `repair` | `repair` | 只有 `confirmRepair=true` 才执行白名单动作 |
| 9 | `report` | `general-report` | 报告含视觉观察、候选原因、下一步 |

```bash
# 仅基于描述/图片（不需要机器人连接）
node workflow/visual-diagnosis-adapter.js \
  --description "右臂抬不起来" --part arm \
  --image ./diagnosis/images/arm.jpg \
  --observations diagnosis/vision-observations.json

# 有机器人连接时追加只读 probe/selfcheck
ROBAN_HOST=<ROBOT_IP> node workflow/visual-diagnosis-adapter.js \
  --description "右臂抬不起来" --part arm \
  --image ./diagnosis/images/arm.jpg --observations diagnosis/vision-observations.json

# 白名单动作需要用户确认后才加 --confirm
```

视觉 schema 见 [`templates/vision-observations.example.json`](../templates/vision-observations.example.json)。
报告写入 `diagnosis/reports/`。

边界：

- 图片/自然语言只是证据，不是物理真值；不能仅凭图片断言电机/编码器损坏；
- 出现冒烟/焦味/过热/跌落时先让用户停止并人工断电检查；
- 只执行白名单动作，且必须用户确认；不进行运动/重启/上电卸力/写 offset；
- 零点/角度问题会推荐转 `roban-zero-calibration` 或 `joint-identify-adapter`。

`runTask(ctx, task, { until, state, skip })` 支持在任意阶段停止：

```js
await runTask(ctx, TASKS['roban-auto-repair'], { until: 'plan' });
```

## 五、并行执行与安全边界

### 并行模型

- **按组件归并**：同一根因触发的多条检查项（如 `camera_chin` / `chin_camera_node` / `expected_nodes` / `dead_processes`）合并为一个修复单元，只修一次。
- **单元并行**：不同组件的单元默认并发 3（`ROBAN_REPAIR_CONCURRENCY` 可调）。
- **资源锁**：每个单元声明 `locks`（如 `camera.chin`、`usb:camera`、`bodyhub`），相同资源的单元自动串行，避免抢同一链路。
- **人工单元不排队**：`autoRepairable=false` 的组件（总线、温度、传感器等）只产出人工建议，不进入执行队列。
- **失败回退**：知识库剧本失败 → 组件的安全阶梯（当前为重启下巴相机 + 一次重试）；仍失败则记失败经验并进报告。
- **历史日志不算实时故障**：只剩 `dead_processes` 这类历史日志证据时，单元降级为人工观察，不自动重启。

### 允许的只读操作

`GetStatus`、`GetMasterID`、`GetJointAngle`、`PresentTemperature`、`ScanServo`（仅 `preReady`）、`rosnode/rostopic` 查询、日志读取。

### 运动指令与立即停止

任何可能让机器人运动或改变关节扭矩的动作（关节目标、头部、步态、遥控、零位标定、上电/卸力等）都必须在执行前：

1. 向用户说明动作、范围、速度、时长、预期运动和风险；
2. 得到用户逐次明确批准（`motionApproved=true`）；
3. 给出可执行的立即停止方式（`stopPlan` 非空）：硬件急停/断电优先，其次是终端 Ctrl-C；
   关闭网页或断开 SSH 不算停止；
4. 由 `safety.reviewActions()` 审查通过后才允许执行。

CLI 对应 `--motion-approved` 与 `ROBAN_STOP_PLAN`；两者缺一，运动动作会被 `blocked`。

### 白名单修复

只有 `restart-chin-camera`（L2，非运动节点），且必须：

- BodyHub 不在 `walking` / `running` / `error`；
- `masterID = 0`（无人占用控制权）；
- `/dev/usb_cam` 存在；
- 修复后 `/chin_camera/image` 频率 ≥ 5 Hz 持续 5 秒。

知识库剧本在执行前还会经过白名单校验；未知 action 不会下发到机器人。

### 明确禁止

- 把机器人 IP 写入知识库，或从知识库/历史会话/报告中读取 IP
- `StateJump` 的 `setStatus` / `reset`
- 向 `MotoPosition`、`HeadPosition`、`jointControl`、`gaitCommand` 发布消息
- `SetServoLockState*`、`SetServoTarPosition*`、`SyncWrite*`、`InstWrite*`
- 修改 `offset.yaml`、`dxlInitPose.yaml`、udev 规则
- `killall roslaunch`、重启整套系统或机器人
- 未取得逐次批准、未提供立即停止方式的任何运动指令

### 数据语义

- `GetJointAngle` 是软件缓存角，不是电机实测位置。
- 温度 0 是无读数，不是 0°C。
- 电池用电压判断，`BatteryState.percentage` 恒为 0 是驱动未计算。
- `Status` / `ServoPositions` / `joint` 话题是事件式发布，短窗口无消息不等于故障。
- `DirectMethod/GetServoPositionAll`、`GetServoLockStateAll` 会切换 BodyHub 状态，按写操作对待。

## 六、在 dsh 中调用

### 方式 A：dsh 直接跑 Node workflow

```bash
# 只读自检 + 归因
ROBAN_HOST=<ROBOT_IP> node workflow/harness-adapter.example.js selfcheck

# 自动修复（先 dry-run 看计划，再 --confirm 真正执行）
ROBAN_HOST=<ROBOT_IP> node workflow/harness-adapter.example.js auto
ROBAN_HOST=<ROBOT_IP> node workflow/harness-adapter.example.js auto --confirm
```

然后把 `final/reports/` 里的 Markdown 读给用户；知识库更新见 `kb/events.jsonl`。

### 方式 B：dsh 的 LLM workflow 分析层

1. 先跑 `selfcheck` 或 `plan` 得到确定性结果；
2. 把 `templates/dsh-analysis-workflow.js` 作为 dsh workflow 的 `script`；
3. `args = { ip, evidence }`，`evidence` 传 `selfcheck` 的 `state`。

这一层只做解释、排序和报告，不执行修复；修复仍由 `repair` / `repair-parallel` 的白名单动作完成。

### 方式 C：dsh workflow 工具编排（多代理）

`workflow/dsh-workflow.js` 是给 dsh `workflow` 工具用的脚本体（多代理编排）：
检测代理 → 并行分析（根因 / 知识库）→ 修复代理（`confirm=true` 才真修）→ 报告代理。

在 dsh 里明确说“用 workflow 跑机器人自动修复”即可；模型会读取该文件并调用 `workflow` 工具，
`args = { host, confirm, motionApproved, stopPlan }`。`host` 必须来自用户当前消息；
运动动作只有在 `motionApproved=true` 且 `stopPlan` 非空时才会被执行。也可以直接用
`/roban-auto-repair` 技能作为入口，技能会转去调用 workflow 工具。

> dsh 的 `workflow` 没有用户可编辑的命名注册表或斜杠入口：它由模型在用户明确要求 workflow 时调用，
> 脚本通过 `script` 参数传入。因此“命名 workflow”要靠技能/提示词做入口，实际执行单元仍是 workflow 工具。

### 方式 D：项目斜杠命令（dsh-slash-command-filesystem）

本机 desktop profile 已安装第三方插件 `dsh-slash-command-filesystem@0.2.2-rc.1`
（把 Markdown 命令文档注册成 dsh 原生命令）。项目命令放在 `final/.dsh/commands/`：

| 斜杠命令 | 作用 |
|---|---|
| `/roban-detect [说明]` | 连接机器人做只读检测（`selfcheck` + `plan --json`），不修复 |
| `/roban-workflow [confirm\|dry-run]` | 调用 dsh `workflow` 工具执行 `workflow/dsh-workflow.js` 完整修复编排；默认 dry-run |

命令文档是普通 Markdown：frontmatter 写 `description` / `argument-hint`，正文就是送给模型的提示词，
`$ARGUMENTS` 接收斜杠命令后面的参数。插件按会话 cwd 探测项目根（无 `.git` 时回退到 cwd），
并监听文件变化；新增/修改命令文档即时生效。命令名来自文件名，子目录会形成命名空间。

> 该插件是第三方包（npm `dsh-slash-command-filesystem`），安装时已写入 desktop profile 的
> `package.json` 的 `dsh.profile.bundles`。若命令菜单未出现，重启一次 dsh 客户端即可。

## 七、当前机器人基线（2026-11-19 实测）

```text
lemon-NUC8i3BEH / Ubuntu 16.04 / ROS Kinetic
BodyHub preReady, masterID=0, queues 0/0
22 个 ROS 节点（含 /chin_camera）；GetJointAngle 22 个；ScanServo 1–22 全部在线
RealSense 彩色 16.5 Hz；下巴相机 13.3 Hz（自动修复后）；电池 12.2 V；NTP 已同步
```

2026-11-19 自动修复记录（知识库 `camera-chin-startup-order` 命中）：

- 首次检测：`camera_chin` FAIL、`chin_camera_node` WARN、`expected_nodes` 缺 `/chin_camera`；
- `restart-chin-camera` 成功（19.2 s），复检 `camera_chin` OK（10.5 Hz），FAIL 2 → 0；
- 经验写回：`kb/events.jsonl` 新增 1 条、`camera-chin-startup-order` 统计 attempts=1 / successes=1；
- 约 2.4 分钟后复发：rosout 报 `VIDIOC_DQBUF error 19, No such device`，dmesg 显示
  `usb 1-1 USB disconnect` 后重新枚举（AlcorMicroCorp `1e2f:9785`）——说明重启只是临时缓解，
  复发诱因是 USB 链路/供电不稳定；
- 再次运行 `auto --confirm` 时，冷却期（15 分钟）内复发被识别：计划 `blocked`、未重启，
  `kb/events.jsonl` 追加 `kind=recurrence`，案例 `recurrences=1`。当前需人工检查下巴相机
  USB 线缆/接口/供电后再执行修复。

已知现象：

- `dxlBulkRead` 间歇错误（14→19 缓慢增长），但总线扫描 1–22 全部在线；优先查供电/线缆/接头。
- 温度 ID 14/15/19/21/22 返回 0（无读数）。
- `/imu/Torso`、SensorHub 温度在短窗口无数据，标 `UNKNOWN`，不判故障。

## 八、后续扩展

- **新增自动修复动作**：先加进 `repair.js` 白名单（远端脚本 + 前置检查 + 复检），再在 `fault-units.js` 给组件配 `generatedPlaybook`；知识库案例复用同一 action。
- **新组件归并**：在 `fault-units.js` 的 `COMPONENTS` / `CHECK_COMPONENT` 注册，写 `targets`、`locks`、人工建议。
- **参数调节 / 遥控**：分别新增 `param-tune.js` / `teleop.js`，遥控必须有超时停止；读写分离与确认门禁保持一致。
- **知识库演化**：定期看 `kb/events.jsonl` 的成功率与 `degraded` 案例，人工复核后再改种子经验。
