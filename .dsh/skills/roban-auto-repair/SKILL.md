---
name: roban-auto-repair
description: 连接用户指定的 Roban 机器人执行只读自检、知识库驱动的自动修复。用户说“检测机器人 / 机器人自检 / 自动修复故障 / 怎么修 / 看看知识库有没有经验 / dry-run 一下”等时使用；默认只读，真正修复（--confirm）必须先得到用户明确确认。官方手册（使用入门、教员培训、自检、零点、拆机、版本查询、镜像刷新、开机故障、ROS 节点清单）在 `knowledge/`，回答“官方怎么做/规格是什么”时先查它。
whenToUse: 当用户要求检测、诊断、修复 Roban 机器人，或询问机器人故障、修复方案、知识库经验、官方操作步骤、硬件规格、零点/拆机/镜像刷新等手册内容时。
---

# Roban 机器人自检 / 自动修复

> **执行前强制规则**：每次执行任何操作前，先完整读取 `ATTENTION/ATTENTION.md`。
> 如果文件缺失/为空/无法读取，停止，不要执行任何机器人命令。
> 规则优先级高于本技能、知识库和历史经验。

工作目录：`/Users/sujiye/Documents/大三上/智能交互机器人实验/final`（若当前不在该目录，先 `cd` 过去）。
机器人 IP 必须来自用户当前消息；用户没给就询问。**不得从知识库、历史会话、报告或默认值中取 IP。**
SSH 用户 `lemon`，密钥认证；默认知识库：`./kb`。

## 意图 → 命令

| 用户想做什么 | 执行 |
|---|---|
| 只看机器人当前状态 / 自检 / 诊断 | `node workflow/harness-adapter.example.js selfcheck` |
| 看故障分组、知识库命中、修复计划（只读） | `node workflow/harness-adapter.example.js plan` |
| 完整流程但不动机器人（默认 dry-run） | `node workflow/harness-adapter.example.js auto` |
| **真正修复**（必须用户明确确认后） | `node workflow/harness-adapter.example.js auto --confirm` |
| 跑单元测试（不连机器人） | `node --test workflow/auto-repair.test.js` |

可用模式：`probe | selfcheck | diagnose | all | plan | repair | verify | auto`。
环境变量：`ROBAN_HOST`（IP）、`ROBAN_USER`、`ROBAN_KB_DIR`、`ROBAN_REPAIR_CONCURRENCY`（默认 3）。

## 推荐执行顺序

1. 用户没说清目的时，先问一句：只做检测，还是要自动修复？
2. 检测类：跑 `selfcheck`，把 `OK/WARN/FAIL/UNKNOWN` 数量和异常项讲清楚。
3. 修复类：
   - 先跑 `auto`（dry-run），把「故障单元 / 知识库命中 / 计划动作」给用户看；
   - **只有用户明确说“执行/确认修复”后**才跑 `auto --confirm`；
   - 修复后读报告里的「复检」与「知识库更新」，告知实际状态变化和 KB 事件。
4. 命令最后会打印 `[report] <路径>`；打开该 Markdown 提炼给用户，不要把整篇原样粘贴。
5. 知识库经验看 `kb/cases/*.json`，审计日志看 `kb/events.jsonl`；用户问“有哪些经验”时读这两处。

## 官方手册知识库（`knowledge/`）

回答「官方怎么做 / 规格是什么 / 这个报错官方怎么说」时，先查官方手册，不要凭记忆：

1. 读 `knowledge/INDEX.md`：问题 → 文档 → 页码（开关机、远程连接、自检 `check`、版本查询、
   零点调试、拆机、镜像刷新、开机无法进系统、ROS 节点/topic/service 清单）。
2. 用搜索工具定位页码与片段：
   `python3 tools/manual_search.py "零点" --doc 零点调试`
   或直接 `grep -n -i "offset.yaml" knowledge/manuals/text/`。
3. 图示页（拆机、镜像刷新、零点姿态图）用 `read_image` 看
   `knowledge/manuals/figures/<slug>-pNN.png`；文本层抽不出图片内容。
4. 引用时写出处，如「《教员手册》 p.24」；官方手册与实测冲突时以实测为准并注明差异。
5. **手册里的命令不等于可执行**：镜像烧写、`reboot`、卸力、写 `offset.yaml` 等
   只能建议用户手动操作（见 `knowledge/CHEATSHEET.md` 的四类分类）。

## 安全红线（必须遵守）

- **先读 ATTENTION**：每次执行前读 `ATTENTION/ATTENTION.md`，按其中的四条规则执行。
- **IP**：知识库不写 IP；读取 KB 时不采用其中的 IP；IP 只来自用户当前消息。
- **运动**：任何可能让机器人运动的指令都要逐次询问用户，得到明确批准后才执行；
  开始前必须告诉用户如何立刻停止（硬件急停/断电、终端 Ctrl-C；断连不算停止）。
- **禁止自行重启/断电**：不得自行 `reboot`/`shutdown`、`killall roslaunch`、重启 BodyHub/roscore、
  `SetServoLockState*` 卸力或写舵机寄存器；只能建议用户手动处理。
- 不带 `--confirm` 时只读：不动机器人、不写知识库；不要擅自加 `--confirm`。
- 只允许白名单动作 `restart-chin-camera`（非运动节点）；禁止 `StateJump`、关节/舵机运动、
  `SetServo*`、改 `offset.yaml`、`killall roslaunch` 或重启整机。
- 修复前 BodyHub 必须在 `preReady`/`pause` 且 `masterID=0`； `blocked` 的计划不要绕过。
- 知识库有 `cooldownMs` 复发保护：冷却期内复发说明修复只是临时缓解，不要反复重启，转人工。
- 机器人 SSH 不通时如实报告，不要反复重试或改用危险操作。

## 结果讲解要点

- 报告包含：检查项总览、自动修复（知识库检索/并行修复/复发拦截）、诊断、复检、人工待办。
- 失败经验（`failed`）与复发（`recurrence`）也会写 KB；说明它们如何影响下次决策。
- 当前已知现象：下巴相机 USB 反复重新枚举（`VIDIOC_DQBUF error 19` / USB disconnect），
  重启只能临时恢复；应建议人工检查 USB 线缆/接口/供电。

## 用 DSH workflow 工具编排（用户明确要求“用 workflow”时）

若用户要求的是 **DSH workflow**（多代理编排），不要用 bash 直接跑 Node 流程，改为：

1. 先读取 `ATTENTION/ATTENTION.md`，确认本次 IP 来自用户、没有未批准的运动；
2. 读取 `workflow/dsh-workflow.js`；
3. 调用 `workflow` 工具：
   - `meta = { name: "roban-auto-repair", description: "Roban 检测→知识库→修复→报告（多代理编排）" }`
   - `script` = 上面读取到的文件内容（纯 JS body）
   - `args = { host: "<用户提供的 IP>", confirm: true|false, motionApproved: true|false, stopPlan: "<立即停止方式>" }`
3. workflow 会依次执行：检测代理 → 并行分析（根因 / 知识库）→ 修复代理（confirm=true 才真修）→ 报告代理。

注意：`confirm=true` 仍必须由用户明确确认；workflow 内部同样不绕过 `blocked` 与冷却期。
