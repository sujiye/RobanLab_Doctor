---
description: 通过手动转动关节识别 ID，再手动归零并生成零位 offset 补丁（人工在环，控制读需逐次批准）
argument-hint: "[机器人 IP]"
---
执行“手动转动识别关节 → 手动归零 → 生成候选 offset”的流程。

0. 先完整读取 `ATTENTION/ATTENTION.md`；缺失/为空/无法读取就停止。
   确认 IP 来自用户当前消息；不得从知识库/历史会话/报告读取。
1. 安全确认：
   - 机器人已支撑，手臂不会因误动作/卸力跌落；
   - BodyHub 处于 `preReady`，`masterID=0`；
   - 明确告诉用户：每次读取会短暂 `StateJump setStatus → reset`，不运动、不改扭矩；
   - **逐次询问用户是否允许这次控制读**，得到明确同意才加 `--control-approved`。
2. 读取基线（用户批准后）：
   cd "/Users/sujiye/Documents/大三上/智能交互机器人实验/final" && ROBAN_HOST=<ROBOT_IP> node workflow/joint-identify-adapter.js baseline --control-approved
3. 告诉用户：手动大幅转动**一个**关节（其他关节保持不动），转完告诉我。
4. 用户确认转完后，读取并识别：
   cd "/Users/sujiye/Documents/大三上/智能交互机器人实验/final" && ROBAN_HOST=<ROBOT_IP> node workflow/joint-identify-adapter.js diff --control-approved
   - 输出候选 ID 和变化量；
   - 如果 `ambiguous` 或 `no_clear_motion`，让用户只转一个关节/重新 baseline，不要猜。
5. 把识别到的 ID 告诉用户确认；确认后让用户把该关节**手动**放到正确零点。
6. 用户确认归零后，读取该关节在软件里的角度：
   cd "/Users/sujiye/Documents/大三上/智能交互机器人实验/final" && ROBAN_HOST=<ROBOT_IP> node workflow/joint-identify-adapter.js zero --joint <ID> --control-approved
   记录 `zeroAngle`。
7. 生成候选 offset（不写机器人）：
   cd "/Users/sujiye/Documents/大三上/智能交互机器人实验/final" && ROBAN_HOST=<ROBOT_IP> node workflow/calibrate-adapter.js calibrate --joint <ID> --layer pose --expected-angle 0 --actual-angle <zeroAngle> --sign -1 --note "手动转动识别 ID<ID> 后零点标定"
8. 读取 `calibration/reports/` 最新报告，向用户解释当前 offset → 候选 offset、补丁/apply 脚本路径。
9. 明确告诉用户：
   - apply 脚本必须由用户手动运行；
   - 运行后必须由用户手动重启 BodyHub；
   - 重启后复测，再运行 `calibrate-verify`。
10. 禁止 agent 自己写 offset、重启 BodyHub、上电/卸力或运动；如果关节转不动，让用户按厂家安全流程手动释放关节，不要由 agent 下发电机指令。

用户输入：$ARGUMENTS
