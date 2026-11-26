# RobanLab Doctor

Roban 机器人（Ubuntu 16.04 + ROS Kinetic + BodyHub）的**故障自检 / 知识库驱动自动修复 Agent**。
整套能力由「确定性 Node workflow + 可注册 skill + 本地经验知识库 + 官方手册知识库」组成，
零 npm 依赖，设计上是 **DeepSeek Harness（DSH）里的项目级 Agent 工具链**。

一句话：连接机器人 → 只读证据采集 → 规则自检 → 归因 → 检索知识库经验 → 并行修复（白名单、默认 dry-run）→ 复检 → 经验回写 → 生成报告。

> 详细使用手册：[agent/USAGE.md](agent/USAGE.md)；技术说明（阶段、安全边界、扩展方式）：[agent/README.md](agent/README.md)。

---

## 1. 能力概览

| 能力 | 入口 | 是否动机器人 |
|---|---|---|
| 只读自检 + 归因（含官方基线对照） | `node workflow/harness-adapter.example.js selfcheck / baseline / plan` | 否 |
| 知识库驱动的自动修复 | `... auto`（dry-run）→ `... auto --confirm` | 仅白名单动作，需 `--confirm` |
| 零位标定（人工在环 + 手机测量） | `node workflow/calibrate-adapter.js ...` | 否；只生成候选 offset / 补丁 / apply 脚本 |
| 不知道关节 ID：手动转动识别 | `node workflow/joint-identify-adapter.js ...` | 控制读（短暂占用状态机），需逐次批准 |
| 泛用视觉诊断（描述 + 图片） | `node workflow/visual-diagnosis-adapter.js ...` | 否；可完全离线运行 |

**明确不能做**（由 `skills/safety.js` 强制执行，规则见 [ATTENTION/ATTENTION.md](ATTENTION/ATTENTION.md)）：

- 不重启机器人 / 不 `killall roslaunch` / 不重启 BodyHub、roscore；
- 不让关节上电、卸力、运动（运动类指令必须逐次获得用户批准并给出立即停止方式）；
- 不自动写 `offset.yaml`（只生成补丁与人工 apply 脚本）；
- 知识库永不记录机器人 IP；当前 IP 只能来自用户当前对话的明确输入；
- 不凭图片断言硬件损坏，不假装 `GetJointAngle`（软件缓存角）是机械真值。

## 2. 目录结构

```text
RobanLab_Doctor/
├── ATTENTION/ATTENTION.md          # 最高优先级安全规则，每次执行前必读
├── agent/                          # README（技术说明） + USAGE（使用手册）
├── .dsh/
│   ├── commands/                   # DSH 斜杠命令（5 个 /roban-* 命令文档）
│   └── skills/roban-auto-repair/   # DSH 项目级技能入口（SKILL.md）
├── workflow/
│   ├── workflow.js                 # roban-selfcheck / roban-auto-repair 编排
│   ├── calibration-workflow.js     # 零位标定编排
│   ├── general-diagnosis-workflow.js # 泛用视觉诊断编排
│   ├── harness-adapter.example.js  # 主 CLI + ctx 适配
│   ├── calibrate-adapter.js        # 零位标定 CLI
│   ├── joint-identify-adapter.js   # 关节 ID 识别 CLI
│   ├── visual-diagnosis-adapter.js # 视觉诊断 CLI
│   ├── dsh-workflow.js             # DSH workflow 工具的多代理编排脚本体
│   └── *.test.js                   # 四组 node:test 单测
├── skills/                         # 23 个同构 skill + 辅助模块（安全、SSH、判定、修复、标定、KB）
├── kb/                             # 经验知识库：cases/*.json + events.jsonl（不含 IP）
├── knowledge/                      # 官方手册知识库：12 份 PDF → 可搜索 Markdown + 索引/对照表
├── tools/
│   ├── phone-camera/               # 手机拍照测量页（零依赖本地 HTTP 服务）
│   ├── extract_manuals.py / manual_search.py / render_manual_pages.py
├── calibration/ diagnosis/ reports # 标定产物 / 诊断产物 / 报告输出
├── docs/ docs_figures/             # 技术调研报告渲染脚本与架构图
└── RobanLab_Doctor_技术调研报告_v1.0.docx
```

## 3. 快速开始（纯 CLI）

前提：本机能免密 SSH 到机器人（默认用户 `lemon`）。

```bash
ssh lemon@<ROBOT_IP> hostname
```

```bash
# 只读自检 + 归因（不动机器人、不写知识库）
ROBAN_HOST=<ROBOT_IP> node workflow/harness-adapter.example.js selfcheck

# 官方基线对照（机型/版本/开机/零点/硬件/topic 清单）
ROBAN_HOST=<ROBOT_IP> node workflow/harness-adapter.example.js baseline

# 看故障分组、知识库命中、修复计划（只读）
ROBAN_HOST=<ROBOT_IP> node workflow/harness-adapter.example.js plan

# 完整流程 dry-run（不动机器人、不写知识库）
ROBAN_HOST=<ROBOT_IP> node workflow/harness-adapter.example.js auto

# 真正执行修复（必须先得到用户明确确认）
ROBAN_HOST=<ROBOT_IP> node workflow/harness-adapter.example.js auto --confirm
```

可用模式：`probe | selfcheck | baseline | diagnose | all | plan | repair | verify | auto`。
报告写入 `reports/roban-selfcheck-<时间戳>.md`；知识库审计日志为 `kb/events.jsonl`。

主要环境变量：

| 变量 | 作用 | 默认 |
|---|---|---|
| `ROBAN_HOST` | 机器人 IP（必填，无默认） | — |
| `ROBAN_USER` / `ROBAN_PORT` / `ROBAN_PROXY` | SSH 用户 / 端口 / 代理 | `lemon` / `22` / 无 |
| `ROBAN_KB_DIR` / `ROBAN_REPORT_DIR` | 知识库 / 报告目录 | `kb/` / `reports/` |
| `ROBAN_REPAIR_CONCURRENCY` | 并行修复并发上限 | `3` |
| `ROBAN_MOTION_APPROVED` / `ROBAN_STOP_PLAN` | 运动批准 / 立即停止方式 | 未设置 |

测试（不需要机器人）：

```bash
node --test workflow/auto-repair.test.js workflow/safety.test.js \
            workflow/calibration.test.js workflow/general-diagnosis.test.js
```

## 4. 在 DSH（DeepSeek Harness）中使用

本仓库就是 DSH 的「项目级工具链」：把 DSH 会话的工作目录指向本仓库根目录，
`.dsh/` 下的技能与命令会被自动发现。有四种使用方式：

### 方式 A：项目技能 `roban-auto-repair`（推荐日常入口）

`.dsh/skills/roban-auto-repair/SKILL.md` 注册为 DSH 技能。在 DSH 会话里用自然语言即可触发：

> “检测机器人” / “机器人自检” / “自动修复故障” / “看看知识库有没有经验” / “dry-run 一下”

技能会按意图路由到对应 CLI（只读默认，`--confirm` 必须先得到用户明确确认），
回答“官方怎么做 / 规格是什么”时先查 `knowledge/INDEX.md`。

### 方式 B：斜杠命令（需安装 `dsh-slash-command-filesystem` 插件）

`.dsh/commands/*.md` 被该插件注册成原生命令：

| 命令 | 作用 |
|---|---|
| `/roban-detect [IP] [说明]` | 只读检测（selfcheck + plan），不修复 |
| `/roban-workflow [IP] [confirm\|dry-run]` | 调用 DSH `workflow` 工具执行完整修复编排，默认 dry-run |
| `/roban-calibrate [IP] joint=7 expected=0 actual=3.2 sign=1` | 零位标定：生成候选 offset / 补丁 / apply 脚本 |
| `/roban-calibrate-motion [IP]` | 手动转动识别关节 ID → 手动归零 → 生成补丁 |
| `/roban-visual-diagnosis [IP] [故障描述]` | 泛用视觉诊断：描述 + 图片 + 可选只读证据 |

命令文档是普通 Markdown（frontmatter 写 `description` / `argument-hint`，正文是给模型的提示词，
`$ARGUMENTS` 接收参数），新增/修改即时生效。

### 方式 C：DSH `workflow` 工具（多代理编排）

在 DSH 里明确要求“用 workflow 跑机器人自动修复”，模型读取
[workflow/dsh-workflow.js](workflow/dsh-workflow.js) 作为 `script`，传：

```json
{ "host": "<用户提供的 IP>", "confirm": false, "motionApproved": false, "stopPlan": "" }
```

编排链路：读取 ATTENTION → 检测代理 → 并行分析（根因 / 知识库）→ 修复代理（`confirm=true` 才真修）→ 报告代理。
确定性逻辑仍在 Node workflow 里执行，编排层不绕过安全审查、冷却期与 `blocked` 状态。
`templates/dsh-analysis-workflow.js` 则是只做解释/排序的 LLM 分析层模板。

### 方式 D：直接 bash 跑 Node CLI

DSH 会话内直接执行第 3 节的命令，再把 `reports/` 里的 Markdown 报告提炼给用户。

> **路径说明**：`.dsh/commands/` 与 `workflow/dsh-workflow.js` 里写死了原工作目录
> `/Users/sujiye/Documents/大三上/智能交互机器人实验/final`。克隆到别处使用时，
> 把这些路径换成本仓库根目录即可（`cd` 到仓库根后相对路径本身不变）。

## 5. 知识库

| 目录 | 内容 | 用途 |
|---|---|---|
| `kb/` | 故障签名 → 修复剧本 → 复检判据（JSON），人工种子 + agent 习得 | 自动修复决策 |
| `knowledge/` | 12 份官方/项目 PDF 转成的可搜索 Markdown、页码索引、官方自检项对照表 | 查“官方怎么做 / 官方规格” |

知识库规则：只存经验不存命令，剧本动作必须命中 `skills/repair.js` 白名单；成功/失败都写 `kb/events.jsonl`；连续失败 ≥2 次标记 `degraded`；修复成功后冷却期内复发直接 `blocked` 转人工；所有写入自动 IP 脱敏。

## 6. 安全边界（摘要）

四条硬规则（完整见 [ATTENTION/ATTENTION.md](ATTENTION/ATTENTION.md)，代码层每次执行前重新读取并强制）：

1. **知识库不得记录机器人 IP**，也不得从知识库/历史会话/报告取 IP；
2. **可能让机器人运动的指令必须逐次询问用户**，说明动作、范围、风险与立即停止方式；
3. **不得自行重启机器人或让关节断电/卸力**，只能建议用户手动处理；
4. **所有指令显式、可立即停止**：硬件急停/断电优先，其次终端 Ctrl-C；关闭网页或断开 SSH 不算停止。

当前唯一白名单自动修复动作：`restart-chin-camera`（非运动节点），前置条件为 BodyHub 不在
`walking/running/error`、`masterID=0`、`/dev/usb_cam` 存在，且修复后 `/chin_camera/image` ≥5 Hz 持续 5 秒。

## 7. 已知基线（2026-11-19 实测）

- 机型 lemon-NUC8i3BEH / Ubuntu 16.04 / ROS Kinetic；BodyHub `preReady`，`masterID=0`；
- 22 个 ROS 节点、22 个关节角、`ScanServo` 1–22 全部在线；RealSense 16.5 Hz，下巴相机 13.3 Hz；
- 下巴相机存在启动竞态（知识库 `camera-chin-startup-order` 命中并修复成功），约 2.4 分钟后因 USB 链路复发——复发被冷却期识别并转人工；
- `dxlBulkRead` 间歇错误、温度 0 为无读数、IMU/SensorHub 短窗口无数据：均不判故障，人工确认优先。
