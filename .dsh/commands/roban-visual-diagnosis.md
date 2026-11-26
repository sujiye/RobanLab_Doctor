---
description: 泛用视觉故障诊断：结合自然语言描述、现场图片和只读软件证据，输出候选原因与安全下一步
argument-hint: "[机器人 IP（可选）] [故障描述]"
---
执行 Roban 泛用故障诊断。核心原则：自然语言 + 图片 + 只读软件证据互相校验，不能只凭图片断言故障。

0. 先完整读取 `ATTENTION/ATTENTION.md`；缺失/为空/无法读取就停止。
   - IP 如需要必须来自用户当前消息；不得从知识库/历史会话/报告读取。
   - 出现冒烟/焦味/过热/跌落时，先让用户断电并人工检查，不做后续诊断。
1. 向用户收集（缺什么问什么）：
   - 用一两句话描述异常：什么部位、什么现象、什么时候开始、是否偶发；
   - 最近是否拆装/摔碰/升级/换电池；
   - 屏幕/终端报错原文；
   - 照片或视频帧：优先让用户直接拖入对话；如果是本地文件，记录路径。
2. 如果用户没有图片：
   - 说明“没有图片也能先给候选原因，但视觉信息会缺失”；
   - 如需拍照，可运行 `node tools/phone-camera/server.js`，让用户用手机打开终端打印的地址拍照/测量；
   - 或者让用户直接把照片拖进对话。
3. 看图并填写视觉观察：
   - 只能写画面中确实可见的事实；看不清的放 `uncertainties`；
   - 结构参考 `templates/vision-observations.example.json`；
   - 写到 `diagnosis/vision-observations.json`，不要编造关节内部状态、扭矩、编码器好坏。
4. 运行诊断（有机器人 IP 时加 `ROBAN_HOST`，没有则只基于描述/图片）：
   cd "/Users/sujiye/Documents/大三上/智能交互机器人实验/final" && ROBAN_HOST=<ROBOT_IP> node workflow/visual-diagnosis-adapter.js --description "<用户描述>" --part "<部位>" --since "<时间>" --recent "<最近变化>" --error "<报错>" --image <图片路径> --observations diagnosis/vision-observations.json
   注意：`--image` 可以重复；手机 capture JSON 用 `--capture <capture.json>`。
5. 读取 `diagnosis/reports/general-diagnosis-*.md`，向用户解释：
   - 症状标签与风险等级；
   - 视觉可见事实与不确定性；
   - 软件证据（有 ROBAN_HOST 时）；
   - 候选原因、置信度、还需补充的信息；
   - 白名单安全动作（如 restart-chin-camera）和推荐 workflow。
6. 如果候选原因里有白名单动作：
   - 先说明动作、影响和复检方式，问用户是否执行；
   - 只有用户明确同意才加 `--confirm` 重跑；
   - 不要擅自执行运动、重启、上电/卸力或写 offset。
7. 如果是零点/角度问题，建议转 `/roban-calibrate` 或 `/roban-calibrate-motion`；如果是软件节点问题，建议 `/roban-workflow`。
8. 视觉结论必须标明“图片角度/遮挡/光照会影响判断”，并保留 uncertainties。

用户输入：$ARGUMENTS
