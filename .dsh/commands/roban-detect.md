---
description: 连接用户指定的 Roban 机器人做只读检测（自检 + 知识库计划），不执行任何修复
argument-hint: "[机器人 IP] [额外说明，例如：只看下巴相机]"
---
执行 Roban 机器人只读检测，禁止修复。

工作目录：/Users/sujiye/Documents/大三上/智能交互机器人实验/final

步骤：
0. 先完整读取 `ATTENTION/ATTENTION.md`；缺失/为空/无法读取就停止。
   - IP 必须来自用户当前输入；如果 `$ARGUMENTS` 里没有 IP，先问用户；
   - 不得从知识库、历史会话（session.md）、报告或默认值取 IP。
1. 执行只读自检（把 `<ROBOT_IP>` 换成用户给的 IP）：
   cd "/Users/sujiye/Documents/大三上/智能交互机器人实验/final" && ROBAN_HOST=<ROBOT_IP> node workflow/harness-adapter.example.js selfcheck
2. 执行只读计划（故障分组 + 知识库检索，不修复）：
   cd "/Users/sujiye/Documents/大三上/智能交互机器人实验/final" && ROBAN_HOST=<ROBOT_IP> node workflow/harness-adapter.example.js plan --json
3. 读取终端最后打印的 `[report] <路径>` 指向的 Markdown 报告，向用户总结：
   - 总览 OK/WARN/FAIL/UNKNOWN；
   - 故障单元与严重度、知识库命中（案例/score/是否 degraded/是否冷却期）；
   - 计划动作与来源（kb / generated / manual / blocked）；
   - 安全审查结论与人工待办。
4. 不要加 `--confirm`，不要调用 workflow，不要执行任何运动/重启/关节断电指令。
5. 如果用户要求修复，说明请使用 `/roban-workflow`；运动类修复还必须先取得用户逐次批准并给出立即停止方式。

用户补充说明：$ARGUMENTS
