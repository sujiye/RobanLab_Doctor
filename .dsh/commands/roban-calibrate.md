---
description: Roban 零位标定（人工在环 + 手机测量），只生成候选 offset / 补丁 / apply 脚本，不写机器人
argument-hint: "[机器人 IP] [joint=7] [expected=0] [actual=3.2 或 capture.json] [sign=1]"
---
执行 Roban 零位标定工作流。它是**人工在环**流程：读取 offset、计算候选、生成备份/补丁/apply 脚本；不写机器人、不重启 BodyHub、不移动/卸力关节。

步骤：
0. 先完整读取 `ATTENTION/ATTENTION.md`；缺失/为空/无法读取就停止。
1. 收集输入；缺什么问什么：
   - 机器人 IP（必须来自用户当前消息，不能从知识库/历史会话/报告取）；
   - 关节 ID（1–22）、offset 层（默认 `pose`，即 `~/.lejuconfig/offset.yaml`）；
   - 期望角度、实际角度（角度尺/水平仪），或手机测量得到的 capture JSON；
   - 修正方向 `sign`（+1/-1；不确定就先用小角度测试确认）；
   - 现场观察/是否拆装过舵机臂。
2. 如果用户要用手机测量：
   - 运行 `node tools/phone-camera/server.js`，把终端打印的局域网地址给用户；
   - 手机打开页面，固定手机、拍包含基座参考线和连杆的照片，标两条线，提交；
   - 用生成的 `calibration/captures/capture-*.json` 作为 `--capture` 输入。
3. 运行（把占位符换成用户输入）：
   cd "/Users/sujiye/Documents/大三上/智能交互机器人实验/final" && ROBAN_HOST=<ROBOT_IP> node workflow/calibrate-adapter.js calibrate --joint <ID> --layer pose --expected-angle <deg> (--actual-angle <deg> | --capture <capture.json>) --sign <1|-1> --note "<现场观察>"
4. 读取 `calibration/reports/zero-calibration-*.md`，向用户解释：
   - 当前 offset → 候选 offset；
   - 偏差来源、sign、风险提示；
   - 备份/补丁/apply 脚本路径。
5. 明确告诉用户：
   - apply 脚本必须由用户手动在机器人上运行；
   - 运行后必须由用户手动重启 BodyHub；
   - 重启后把关节放回同一参考姿态复测，再运行：
     `ROBAN_HOST=<ROBOT_IP> node workflow/calibrate-adapter.js calibrate-verify --joint <ID> --expected-offset <候选值>`
6. 禁止 agent 自己执行 apply、写 offset、重启 BodyHub、上电/卸力或移动关节；如果用户要求，说明这必须由人工完成。

用户输入：$ARGUMENTS
