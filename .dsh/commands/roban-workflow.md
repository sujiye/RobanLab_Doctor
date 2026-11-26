---
description: 用 dsh workflow 工具执行 Roban 完整修复流程（检测→知识库→并行修复→复检→写 KB），默认 dry-run
argument-hint: "[机器人 IP] [confirm | dry-run | 补充说明]"
---
调用 dsh 的 workflow 工具执行 Roban 完整修复 workflow，不要用 bash 直接跑 Node 流水线。

1. 先完整读取 `ATTENTION/ATTENTION.md`，并确认：
   - IP 来自用户当前输入；没有就询问，不得从知识库/历史会话/报告读取；
   - 本次没有未批准的运动、重启或关节断电动作；
   - 如果有运动动作，必须先取得用户逐次批准，并给出立即停止方式。
2. 读取脚本全文：
   /Users/sujiye/Documents/大三上/智能交互机器人实验/final/workflow/dsh-workflow.js
3. 调用 workflow 工具：
   meta = { "name": "roban-auto-repair", "description": "Roban 检测→知识库→并行修复→复检→报告（多代理编排）" }
   script = 第 2 步读到的文件内容（纯 JS body，原样传入）
   args = {
     "host": "<ROBOT_IP>",
     "confirm": <见第 4 步>,
     "motionApproved": <仅当用户逐次批准运动时为 true>,
     "stopPlan": "<运动前必须告知用户的立即停止方式>"
   }
4. confirm 判定：
   - 用户输入（含本命令参数）包含 confirm、确认、执行修复、真修、apply → true；
   - 否则 → false（dry-run，不动机器人、不写知识库）。
   - 即使 confirm=true，也必须先展示检测、计划和安全审查；遇到 blocked、冷却期复发、
     禁止动作、未批准运动或前置条件不满足时不得绕过。
5. 完成后向用户总结：
   - 安全审查是否通过、是否有违规；
   - 检测结论（OK/WARN/FAIL/UNKNOWN、故障单元）；
   - 知识库命中与计划来源；
   - 实际执行状态（dry_run / apply / success / failed / blocked）与动作；
   - 复检结果与知识库更新（事件数、新增/更新案例）；
   - 人工待办与安全提示。
6. 不要绕开 workflow 直接执行 repair，不要修改白名单、ATTENTION 或 KB 案例来“让它通过”。

用户输入：$ARGUMENTS
