# diagnosis —— 泛用视觉诊断产物

```text
diagnosis/
├── images/                    # 用户/手机拍摄的现场图片
├── vision-observations.json   # 视觉模型看图后填写的结构化观察
└── reports/                   # 泛用诊断 Markdown 报告
```

## 流程

1. 用户描述故障，提供照片/截图；
2. 具备视觉能力的 agent 看图，填写 `vision-observations.json`（只写可见事实 + 不确定性）；
3. `visual-diagnosis-adapter` 可选地连接机器人采集只读 probe/selfcheck；
4. workflow 合并描述、视觉观察和软件证据，输出候选原因、需要补充的信息和安全下一步；
5. 只有白名单动作（当前 `restart-chin-camera`）在用户确认后才执行。

## 边界

- 视觉和自然语言不是物理真值；不能仅凭图片断言电机/编码器损坏；
- agent 不执行运动、不重启机器人、不上电/卸力、不写 offset；
- 出现冒烟/焦味/过热/跌落时，先停止并人工检查；
- 零点/角度问题转 `roban-zero-calibration` 或 `joint-identify-adapter`。
