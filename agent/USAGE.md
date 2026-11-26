# Roban 故障诊断与修复 Agent 使用手册

本手册面向日常使用者，说明这个 agent 能做什么、怎么运行、产物在哪里、出问题怎么排查。
与 `final/` 目录当前代码一致（2026-11-19）。

适用机器人：Roban（Ubuntu 16.04 + ROS Kinetic + BodyHub）。

---

## 1. 能力概览

| 能力 | 入口 | 是否动机器人 |
|---|---|---|
| 只读自检 + 归因 | `node workflow/harness-adapter.example.js selfcheck` | 否 |
| 知识库驱动的自动修复 | `... plan / auto / auto --confirm` | 仅白名单动作，需 `--confirm` |
| 零位标定（人工在环 + 手机测量） | `node workflow/calibrate-adapter.js ...` | 否；只生成补丁，人工 apply |
| 不知道关节 ID：手动转动识别 | `node workflow/joint-identify-adapter.js ...` | 控制读（短暂占用状态机），需逐次批准 |
| 泛用视觉诊断（描述 + 图片） | `node workflow/visual-diagnosis-adapter.js ...` | 否；可完全离线运行 |

**明确不能做：**

- 读不到机械真值时不假装读到了：`GetJointAngle` 是软件缓存，不是电机实测。
- 不自动重启机器人、不 `killall roslaunch`、不重启 BodyHub/roscore。
- 不自动让关节上电/卸力/运动。
- 不自动写 `offset.yaml`（只生成补丁和人工 apply 脚本）。
- 不能仅凭图片断言“电机坏了/编码器坏了”。

---

## 2. 使用前准备

### 2.1 网络与 SSH

```bash
ssh lemon@<ROBOT_IP> hostname
```

能免密执行即准备完成。用户名默认 `lemon`；用 `ROBAN_USER` 覆盖。

### 2.2 机器人状态

大多数流程要求 BodyHub 处于 `preReady`、`masterID=0`（无人占用控制权）。自检命令会读取并报告。

### 2.3 IP 规则（强制）

- 机器人 IP 必须来自用户**当前对话**的明确输入。
- 不得从知识库、历史会话（如 `session.md`）、旧报告或默认值里取 IP。
- 本仓库代码中不存在默认 IP；未提供 `ROBAN_HOST` 时直接报错退出。

### 2.4 工作目录

所有命令都在 `final/` 目录下执行：

```bash
cd "/Users/sujiye/Documents/大三上/智能交互机器人实验/final"
```

### 2.5 每次执行前必读

`ATTENTION/ATTENTION.md` 是最高优先级安全规则。文件缺失/为空时，agent 必须拒绝执行。
代码层（`skills/safety.js`、`skills/ssh-run.js`）会在每次审查和每次 SSH 前重新读取。

---

## 3. 安全规则与确认机制

四条硬规则：

1. 知识库不得记录机器人 IP；读取知识库时也不采用其中的 IP/主机地址。
2. 所有可能让机器人运动的指令，必须逐次询问用户并得到明确批准。
3. 不得自行重启机器人或让关节断电/卸力。
4. 所有指令必须显式、可立即停止；运动前必须告知立即停止方式。

确认机制对照表：

| 操作类 | 需要什么 | 对应开关 |
|---|---|---|
| 只读查询 | 无 | — |
| 白名单修复（当前 `restart-chin-camera`） | 用户明确确认 | `--confirm` |
| 运动指令 | 逐次批准 + 立即停止方式 | `--motion-approved` + `ROBAN_STOP_PLAN` |
| 控制读（刷新实测关节角） | 逐次批准 | `--control-approved` |
| 写 offset / 重启 BodyHub | agent 不允许执行 | 人工运行 apply 脚本并手动重启 |

运动指令的“立即停止”必须包含：

1. 硬件急停或直接切断电源（最可靠，优先）；
2. 发起命令的终端按 Ctrl-C；
3. 关闭网页/断开 SSH **不算**停止；
4. 已产生运动队列时，只能使用现场验证过的停止方式。

---

## 4. 场景一：只读自检

```bash
ROBAN_HOST=<ROBOT_IP> node workflow/harness-adapter.example.js selfcheck
```

输出：`OK / WARN / FAIL / UNKNOWN` 汇总、故障发现、候选原因、白名单修复候选。
不动机器人、不写知识库。

报告写入 `reports/roban-selfcheck-<时间戳>.md`。

只想看连接和原始基线：

```bash
ROBAN_HOST=<ROBOT_IP> node workflow/harness-adapter.example.js probe
ROBAN_HOST=<ROBOT_IP> node workflow/harness-adapter.example.js all
```

---

## 5. 场景二：知识库自动修复

### 5.1 先看计划（完全只读）

```bash
ROBAN_HOST=<ROBOT_IP> node workflow/harness-adapter.example.js plan
```

输出：故障单元、知识库命中（案例 / 分数 / 是否 degraded / 是否冷却期）、计划动作与来源（`kb` / `generated` / `manual` / `blocked`）。

### 5.2 dry-run（不动机器人、不写知识库）

```bash
ROBAN_HOST=<ROBOT_IP> node workflow/harness-adapter.example.js auto
```

### 5.3 真正执行（必须用户明确确认后）

```bash
ROBAN_HOST=<ROBOT_IP> node workflow/harness-adapter.example.js auto --confirm
```

执行内容：白名单动作（当前只有重启下巴相机）、资源锁并行、整体复检、经验写回知识库。

### 5.4 结果状态

| 状态 | 含义 |
|---|---|
| `success` | 动作自报成功，且整体复检通过 |
| `failed` | 动作失败或复检不通过 |
| `blocked` | 安全前置条件不满足 / 冷却期复发 / 安全审查阻止 |
| `manual_required` | 无自动修复路径，只给人工建议 |
| `dry_run` | 只做了前置检查，未执行 |

知识库规则要点：

- 只存经验，不存命令；剧本动作必须在 `skills/repair.js` 白名单内。
- 成功和失败都会记录到 `kb/events.jsonl`；连续失败 ≥2 次标记 `degraded`，下次跳过。
- 冷却期内同故障复发会阻止自动重启并转人工（避免“重启—再掉—再重启”循环）。
- 只有 `--confirm` 的真实执行才写知识库；写入前自动 IP 脱敏。

---

## 6. 场景三：零位标定（人工在环）

适用：你已知道是哪个关节，且能手动把关节摆到正确零点。

### 6.1 测量实际角度

两种方式任选：

- **角度尺 / 数字水平仪**：直接得到实际角度；
- **手机测量页**：见 6.4。

### 6.2 生成候选 offset（不写机器人）

```bash
ROBAN_HOST=<ROBOT_IP> node workflow/calibrate-adapter.js calibrate \
  --joint <ID> --layer pose \
  --expected-angle 0 --actual-angle <实测角度> \
  --sign -1 --note "<现场观察>"
```

参数：

| 参数 | 说明 |
|---|---|
| `--joint` | 1–22 |
| `--layer` | `pose`（`~/.lejuconfig/offset.yaml`，默认）或 `pack`（`bodyhub_new/config/offset.yaml`） |
| `--expected-angle` | 该姿态下应有的角度（手动归零时为 0） |
| `--actual-angle` | 实测角度；也可用 `--capture <capture.json>` |
| `--sign` | offset 修正方向，`1` 或 `-1`；归零场景推荐 `-1`，但必须小角度测试确认 |
| `--note` | 现场观察、是否拆装过舵机臂 |

### 6.3 生成的文件

```text
calibration/backups/   原始 offset 备份
calibration/patches/   候选 offset 文本补丁
calibration/scripts/   人工 apply 脚本
calibration/reports/   标定记录 Markdown
```

apply 脚本只修改 offset 文件并备份，**不会**重启 BodyHub、不会断电、不会移动关节。

### 6.4 手机测量页

```bash
node tools/phone-camera/server.js
```

- 终端会打印 `http://<本机局域网IP>:8787`；手机和电脑在同一 Wi-Fi 下打开。
- 页面流程：拍照/选图 → 标“基座参考线”两点 → 标“连杆方向”两点 → 查看相对角 → 提交。
- 提交后生成 `calibration/captures/capture-<时间戳>.json`（含角度、坐标点、备注）。
- 手机必须固定，画面里要有基座参考线；手持单张照片不能作为绝对零位真值。

用 capture 运行标定：

```bash
ROBAN_HOST=<ROBOT_IP> node workflow/calibrate-adapter.js calibrate \
  --joint <ID> --expected-angle 0 \
  --capture calibration/captures/capture-<时间戳>.json --sign -1
```

### 6.5 人工 apply 与复检

1. 确认机器人已支撑，手臂不会因误动作跌落；
2. 把 `calibration/scripts/apply-offset-*.sh` 复制到机器人并运行（脚本内容可先审阅）；
3. **手动**重启 BodyHub（或按厂家流程重新加载 offset）；
4. 把关节放回同一参考姿态复测：

```bash
ROBAN_HOST=<ROBOT_IP> node workflow/calibrate-adapter.js calibrate-verify \
  --joint <ID> --expected-offset <候选值>
```

偏差 >15° 会警告优先检查舵机臂齿位/连杆；>45° 会直接阻止只靠软件补偿。

---

## 7. 场景四：不知道关节 ID（手动转动识别）

适用：你只知道“某条手臂的某个关节零点不对”，不知道 ID。

原理：`GetJointAngle` 是缓存，手动转动后必须先做一次“控制读”（`StateJump setStatus → reset` 触发 `ReadJointValue()` 刷新），才能读到实测变化。控制读不运动、不改扭矩，但会短暂占用 BodyHub 状态机，**每次都必须得到你的批准**。

### 7.1 三步流程

```bash
# 1) 基线：读取 22 个关节
ROBAN_HOST=<ROBOT_IP> node workflow/joint-identify-adapter.js baseline --control-approved

# 2) 手动大幅转动一个关节（其他关节保持不动），然后识别
ROBAN_HOST=<ROBOT_IP> node workflow/joint-identify-adapter.js diff --control-approved

# 3) 确认 ID 后，手动把该关节摆到正确零点，再读取软件角度
ROBAN_HOST=<ROBOT_IP> node workflow/joint-identify-adapter.js zero --joint <ID> --control-approved
```

### 7.2 识别结果

- `identified`：变化最大的关节即为候选 ID，输出前 5 名变化量；
- `ambiguous`：第二名变化超过第一名 60%，要求只转一个关节或重新 baseline，不猜；
- `no_clear_motion`：最大变化 <1.5°，确认关节已解锁/可自由转动；
- `blocked`：未批准控制读或前置条件不满足；
- `release_failed`：状态机未成功释放，立即停止，不要继续。

中间状态保存在 `calibration/state/`（baseline / identified / zero）。

### 7.3 生成候选 offset

```bash
ROBAN_HOST=<ROBOT_IP> node workflow/calibrate-adapter.js calibrate \
  --joint <ID> --expected-angle 0 --actual-angle <zeroAngle> --sign -1 \
  --note "手动转动识别 ID<ID> 后零点标定"
```

后续 6.5 的人工 apply、手动重启、复检不变。

### 7.4 安全条件

- 机器人已支撑，`preReady`，`masterID=0`；
- 只执行 `StateJump 99 setStatus` → `reset`，脚本用 `trap` 确保退出时释放；
- 结束后检查 `masterID=0`、状态回到 `preReady`；失败立即停止；
- 不运动、不改扭矩、不写 offset、不重启任何节点。

---

## 8. 场景五：泛用视觉诊断

适用：症状说不清、可能是硬件/软件混合问题，或需要结合现场照片判断。

### 8.1 准备视觉观察

让具备视觉能力的 agent 看图后填写 `diagnosis/vision-observations.json`，schema 参考
`templates/vision-observations.example.json`。要求：

- 只写画面中确实可见的事实；
- 看不清、被遮挡、无法判断的内容放进 `uncertainties`；
- 不写“电机坏了/编码器坏了/扭矩异常”这类图片无法证明的结论。

### 8.2 运行

只基于描述/图片（不需要机器人）：

```bash
node workflow/visual-diagnosis-adapter.js \
  --description "右臂抬不起来" --part arm \
  --image diagnosis/images/arm.jpg \
  --observations diagnosis/vision-observations.json
```

有机器人连接时追加只读 probe/selfcheck：

```bash
ROBAN_HOST=<ROBOT_IP> node workflow/visual-diagnosis-adapter.js \
  --description "相机黑屏" --part camera \
  --image diagnosis/images/camera.jpg \
  --observations diagnosis/vision-observations.json
```

可选参数：`--since`、`--recent`、`--error`、`--capture <capture.json>`（可重复）、`--json`。

### 8.3 输出

报告写入 `diagnosis/reports/general-diagnosis-<时间戳>.md`，包含：

- 症状标签与风险等级；
- 视觉可见事实与不确定性；
- 软件证据（有机器人连接时）；
- 候选原因、置信度、还需补充的信息；
- 白名单安全动作与推荐 workflow（如零位问题推荐转标定流程）。

### 8.4 红旗

描述含冒烟/焦味/过热/火花/跌落时，流程会先建议停止并人工断电检查，不继续诊断、不执行任何动作。

---

## 9. 在 dsh 中使用

### 9.1 打开正确的会话目录

在 DeepSeek Harness 中新建会话时选择 `final/` 目录（项目根 = 会话 cwd；该目录没有 `.git`）。
这样 `final/.dsh/` 下的命令和技能才会被发现。

### 9.2 斜杠命令

| 命令 | 作用 |
|---|---|
| `/roban-detect [IP] [说明]` | 连接机器人做只读检测（selfcheck + plan --json），不修复 |
| `/roban-workflow [IP] [confirm\|dry-run]` | 调用 dsh `workflow` 工具执行完整修复编排；默认 dry-run |
| `/roban-calibrate [IP] joint=7 expected=0 actual=3.2 sign=1` | 零位标定：生成候选 offset / 补丁 / apply 脚本 |
| `/roban-calibrate-motion [IP]` | 手动转动识别关节 ID → 手动归零 → 生成补丁 |
| `/roban-visual-diagnosis [IP] [故障描述]` | 泛用视觉诊断：描述 + 图片 + 可选只读证据 |

另有技能 `/roban-auto-repair`（`final/.dsh/skills/roban-auto-repair/SKILL.md`），
自然语言“检测机器人 / 自动修复故障 / 看看知识库”会路由到它。

### 9.3 用 dsh workflow 工具编排

让 agent 读取 `workflow/dsh-workflow.js` 作为 `script`，传：

```json
{
  "host": "<用户提供的 IP>",
  "confirm": false,
  "motionApproved": false,
  "stopPlan": ""
}
```

它会依次运行：读取 ATTENTION → 检测代理 → 并行分析（根因 / 知识库）→ 修复代理（confirm=true 才真修）→ 报告代理。
`confirm=true` 仍必须由用户明确确认；workflow 内部不绕过 `blocked`、冷却期和安全审查。

### 9.4 项目根目录的旧入口

父目录 `.dsh/skills/` 里还有早期的 `robot-ssh` 和 `robot-selfcheck`（dsh 原生只读技能）。
它们是第一版入口，保留兼容；当前完整能力以 `final/` 为准。

---

## 10. 命令速查表

以下命令均在 `final/` 下执行，`<ROBOT_IP>` 替换为用户提供的 IP。

### 10.1 自检与自动修复

```bash
ROBAN_HOST=<ROBOT_IP> node workflow/harness-adapter.example.js probe
ROBAN_HOST=<ROBOT_IP> node workflow/harness-adapter.example.js selfcheck
ROBAN_HOST=<ROBOT_IP> node workflow/harness-adapter.example.js diagnose
ROBAN_HOST=<ROBOT_IP> node workflow/harness-adapter.example.js all
ROBAN_HOST=<ROBOT_IP> node workflow/harness-adapter.example.js plan
ROBAN_HOST=<ROBOT_IP> node workflow/harness-adapter.example.js repair
ROBAN_HOST=<ROBOT_IP> node workflow/harness-adapter.example.js verify
ROBAN_HOST=<ROBOT_IP> node workflow/harness-adapter.example.js auto
ROBAN_HOST=<ROBOT_IP> node workflow/harness-adapter.example.js auto --confirm
```

环境变量：

| 变量 | 作用 | 默认 |
|---|---|---|
| `ROBAN_HOST` | 机器人 IP（必填，无默认） | — |
| `ROBAN_USER` | SSH 用户 | `lemon` |
| `ROBAN_PORT` | SSH 端口 | `22` |
| `ROBAN_PROXY` | SOCKS/ProxyCommand | 无 |
| `ROBAN_KB_DIR` | 知识库目录 | `final/kb` |
| `ROBAN_REPORT_DIR` | 报告目录 | `final/reports` |
| `ROBAN_REPAIR_CONCURRENCY` | 并行修复并发上限 | `3` |
| `ROBAN_MOTION_APPROVED` | 等价于 `--motion-approved` | 未设置 |
| `ROBAN_STOP_PLAN` | 运动的立即停止方式 | 未设置 |
| `ROBAN_STRICT_EXIT` | 自检有 FAIL 时返回退出码 4 | 未设置 |

npm 脚本（`package.json`）：`npm run selfcheck`、`npm run plan`、`npm run auto`、`npm run auto:apply`。

### 10.2 零位标定

```bash
ROBAN_HOST=<ROBOT_IP> node workflow/calibrate-adapter.js calibrate \
  --joint <ID> [--layer pose|pack] --expected-angle <deg> \
  (--actual-angle <deg> | --capture <capture.json>) [--sign 1|-1] [--note "..."]

ROBAN_HOST=<ROBOT_IP> node workflow/calibrate-adapter.js calibrate-verify \
  --joint <ID> [--layer pose|pack] --expected-offset <deg>
```

### 10.3 关节 ID 识别（控制读）

```bash
ROBAN_HOST=<ROBOT_IP> node workflow/joint-identify-adapter.js baseline --control-approved
ROBAN_HOST=<ROBOT_IP> node workflow/joint-identify-adapter.js diff --control-approved
ROBAN_HOST=<ROBOT_IP> node workflow/joint-identify-adapter.js zero --joint <ID> [--expected-zero 0] --control-approved
```

### 10.4 泛用视觉诊断

```bash
# 无机器人
node workflow/visual-diagnosis-adapter.js --description "<描述>" \
  --image <图片> --observations diagnosis/vision-observations.json

# 有机器人（追加只读 probe/selfcheck）
ROBAN_HOST=<ROBOT_IP> node workflow/visual-diagnosis-adapter.js --description "<描述>" \
  --image <图片> --observations diagnosis/vision-observations.json
```

### 10.5 手机测量页

```bash
node tools/phone-camera/server.js
# 环境变量：PHONE_CAM_PORT（默认 8787）、CALIBRATION_DIR（默认 final/calibration/captures）
```

### 10.6 测试

```bash
node --test workflow/auto-repair.test.js
node --test workflow/safety.test.js
node --test workflow/calibration.test.js
node --test workflow/general-diagnosis.test.js
```

`npm test` 只跑 `auto-repair.test.js`；全量请逐条运行上面四条。

---

## 11. 输出与产物位置

| 路径 | 内容 |
|---|---|
| `reports/` | 自检 / 自动修复报告（`roban-selfcheck-*.md`） |
| `kb/cases/*.json` | 种子与自动习得的修复经验（不含 IP） |
| `kb/events.jsonl` | 只追加的修复审计日志（成功/失败/复发） |
| `calibration/captures/` | 手机测量的图片与 JSON |
| `calibration/state/` | 关节识别中间状态（baseline / identified / zero） |
| `calibration/backups/` | 读取到的原始 offset 备份 |
| `calibration/patches/` | 候选 offset 文本补丁 |
| `calibration/scripts/` | 人工 apply 脚本（agent 不执行） |
| `calibration/reports/` | 零位标定记录 |
| `diagnosis/images/` | 现场图片 |
| `diagnosis/vision-observations.json` | 视觉模型看图后的结构化观察 |
| `diagnosis/reports/` | 泛用诊断报告 |

---

## 12. 数据语义与已知现象

### 12.1 数据来源必须分清

| 数据 | 来源 | 能说明什么 |
|---|---|---|
| 指令角度 | `MotoPosition` / `HeadPosition` | 程序希望关节到哪里 |
| 软件缓存角 | `GetJointAngle` | BodyHub 缓存了什么值（只在 preReady 刷新） |
| 事件式角度 | `ServoPositions` | 状态变化时发布，不是周期流 |
| 电机实测位置 | `DirectMethod/GetServoPositionAll` 等 | 舵机报告的位置；读取会切换状态机 |
| 用户观察/图片 | 现场 | 机械结构实际表现 |

- 温度 `0` 是“无读数”，不是 0°C。
- 电池用电压判断；`BatteryState.percentage` 恒为 0 是驱动未计算。
- `Status` / `ServoPositions` / `/joint/*` 是事件式发布，短窗口无消息不等于故障。
- `DirectMethod/GetServoPositionAll`、`GetServoLockStateAll` 会切换 BodyHub 状态，按写操作对待。

### 12.2 2026-11-19 实测已知现象

- 下巴相机存在“设备晚于节点启动”竞态，重启非运动节点可临时恢复；
  约 2.4 分钟后可能因 USB 重新枚举复发（`VIDIOC_DQBUF error 19` / USB disconnect），
  复发时流程会识别冷却期并转人工检查 USB 线缆/接口/供电。
- `dxlBulkRead` 间歇错误但 `ScanServo` 1–22 全部在线：优先查供电、线缆、接头。
- 温度 ID 14/15/19/21/22 返回 0（无读数）。
- `/imu/Torso`、SensorHub 温度短窗口无数据，标 `UNKNOWN`，不判故障。
- 电池电压 12.2 V，NTP 已同步。

---

## 13. 常见问题

| 现象 | 原因与处理 |
|---|---|
| `[fatal] 缺少 ROBAN_HOST` | 未提供 IP；向用户询问当前 IP，不要从历史记录取 |
| `[blocked] 控制读需要用户逐次批准` | 加 `--control-approved` 前必须先得到用户明确同意 |
| `REFRESH_STATUS=aborted_precondition` | BodyHub 不是 `preReady` 或 `masterID≠0`；先让机器人空闲 |
| `REFRESH_STATUS=release_failed` | 状态机未释放；立即停止，人工确认后再继续 |
| 计划 `blocked` | 安全前置条件不满足 / 冷却期复发；不要绕过 |
| 识别结果 `ambiguous` | 多个关节同时变化；只转一个关节，或重新 baseline |
| 标定偏差 >45° | 优先检查舵机臂齿位/连杆/装配，不要只靠 offset 补偿 |
| SSH `No route to host` | 机器人未开机/不在同一网段/Wi-Fi 断开 |
| SSH `Permission denied` | 用户名或密钥不匹配；不要猜密码 |
| 报告里出现旧 IP | 历史产物保留原样，但不得作为当前连接地址 |

---

## 14. 扩展与维护

### 14.1 新增一个 skill

1. 在 `skills/` 新建同构模块：`{ id, title, description, inputs, run(ctx, input) }`；
2. 在 `skills/index.js` 的 `SKILL_FILES` 注册；
3. 如需在流程中使用，在对应 `workflow/*.js` 的 `STEPS` 增加阶段。

### 14.2 新增一个自动修复动作

1. 在 `skills/repair.js` 的 `ACTIONS` 增加动作与远端脚本（含前置检查、复检）；
2. 在 `skills/safety.js` 的 `SAFE_ACTIONS` 增加同名条目，否则安全审查会把它判为未授权；
3. 在 `skills/fault-units.js` 给对应组件配置 `generatedPlaybook`；
4. 再写 KB 案例（`kb/cases/*.json`），动作必须是白名单内的名字。

### 14.3 新增一条知识库经验

参考 `kb/README.md` 的 schema：`component`、`checkIds`、`signature`、`playbook`、`preconditions`、
`verification`、`cooldownMs`。先用 `plan` 做 dry-run 确认命中，再真实执行让 `learn` 累积统计。

### 14.4 新增斜杠命令

在 `final/.dsh/commands/` 新建 Markdown，frontmatter 写 `description` / `argument-hint`，
正文是给模型的提示词，`$ARGUMENTS` 接收参数；命令名来自文件名。

### 14.5 修改安全规则

只改 `ATTENTION/ATTENTION.md`；代码每次执行都会重新读取。不要为了“让流程通过”去改
`skills/safety.js` 的白名单或绕过确认门禁。

---

## 15. 目录结构

```text
final/
├── ATTENTION/ATTENTION.md          # 最高优先级安全规则，每次执行前必读
├── agent/
│   ├── README.md                   # 技术说明（结构、阶段、边界）
│   └── USAGE.md                    # 本使用手册
├── .dsh/
│   ├── commands/                   # /roban-detect、/roban-workflow、/roban-calibrate、
│   │                               # /roban-calibrate-motion、/roban-visual-diagnosis
│   └── skills/roban-auto-repair/   # dsh 技能入口
├── kb/
│   ├── cases/*.json                # 修复经验（seed + learned，不含 IP）
│   └── events.jsonl                # 修复审计日志
├── workflow/
│   ├── workflow.js                 # roban-selfcheck / roban-auto-repair 编排
│   ├── calibration-workflow.js     # 零位标定编排
│   ├── general-diagnosis-workflow.js # 泛用视觉诊断编排
│   ├── harness-adapter.example.js  # 主 CLI + ctx
│   ├── calibrate-adapter.js        # 零位标定 CLI
│   ├── joint-identify-adapter.js   # 关节识别 CLI
│   ├── visual-diagnosis-adapter.js # 视觉诊断 CLI
│   ├── dsh-workflow.js             # dsh workflow 工具脚本体
│   └── *.test.js                   # 四组单测
├── skills/                         # 22 个注册技能 + 辅助模块（探测、判定、修复、标定、诊断、安全）
├── templates/                      # probe.sh、dsh 分析模板、视觉观察 schema
├── tools/phone-camera/             # 手机拍照测量页（零依赖 HTTP 服务）
├── calibration/                    # 标定产物（captures/state/backups/patches/scripts/reports）
├── diagnosis/                      # 诊断产物（images/observations/reports）
├── reports/                        # 自检与修复报告
├── package.json                    # npm 脚本（零依赖）
└── RobanAgent.zip                  # 打包产物（如有更新请重新打包）
```

> 说明：`skills/skill.md` 是早期“实验报告改写”的遗留文档，与机器人 agent 无关，可忽略。
