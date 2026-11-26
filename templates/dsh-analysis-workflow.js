// dsh workflow body: LLM analysis layer on top of the deterministic JS harness.
// Call with args = { ip, evidence }, where evidence is the state returned by:
//   node workflow/harness-adapter.example.js selfcheck
// The workflow is read-only: it explains and prioritizes, but never executes a repair.

phase("analyze");
log("analyzing deterministic evidence for " + args.ip);

const EVIDENCE = JSON.stringify(args.evidence, null, 2);

const DOMAINS = [
  {
    key: "system",
    prompt: [
      "你是机器人系统与 ROS 图分析员。只根据证据判断，不要执行命令。",
      "关注：SSH、主机资源、NTP、ROS Master、期望节点差异、进程退出、日志错误。",
      "区分：节点未启动 / 注册后失联 / 在线但功能异常。",
      "输出：FINDINGS（每条带 [FAIL|WARN|UNKNOWN]、证据字段、置信度、下一步只读检查）+ UNKNOWNS。"
    ].join("\n")
  },
  {
    key: "bodyhub",
    prompt: [
      "你是 BodyHub 与舵机总线分析员。只根据证据判断，不要执行命令。",
      "关注：状态机、控制者、队列、ScanServo、温度、dxlBulkRead 错误、timer 超时。",
      "必须区分：指令角、软件缓存角、总线扫描结果、电机实测位置；证据里没有实测位置。",
      "温度 0 是无读数；扫描齐全但读错误持续，优先怀疑供电/线缆/接头。",
      "输出：FINDINGS + UNKNOWNS，每条引用证据字段。"
    ].join("\n")
  },
  {
    key: "sensors",
    prompt: [
      "你是传感器与相机链路分析员。只根据证据判断，不要执行命令。",
      "关注：/dev/usb_cam、/dev/usb_servo、RealSense 与下巴相机频率、节点可达性、电池电压、IMU、SensorHub 温度。",
      "区分：设备不存在 / 节点存在但无数据 / 事件式低频 / 数据不可用。",
      "BatteryState.percentage 为 0 是驱动未计算，用电压判断。",
      "输出：FINDINGS + UNKNOWNS，每条引用证据字段。"
    ].join("\n")
  }
];

const analyses = await parallel(
  DOMAINS.map((domain) => () =>
    agent(
      domain.prompt + "\n\n确定性证据 JSON：\n" + EVIDENCE,
      { label: "analyze:" + domain.key, phase: "analyze" }
    )
  )
);

phase("synthesize");
log("synthesizing findings");

const synthesis = await agent(
  [
    "你是机器人故障诊断汇总员。下面是三个领域的分析结果，请合并、去重、排序。",
    "规则：",
    "1. 只保留有证据支撑的结论；没有证据的推测放到 NEEDS_USER_INPUT。",
    "2. 严重度顺序：FAIL > WARN > UNKNOWN > OK；同一问题不要重复列出。",
    "3. 区分软件故障、疑似硬件/总线问题、数据不可用。",
    "4. 修复候选只能来自白名单 restart-chin-camera；其余写成人工建议。",
    "5. 每个修复候选给出前置条件、影响范围、复检判据。",
    "输出：SUMMARY / FINDINGS / REPAIR_CANDIDATES / NEEDS_USER_INPUT / MISSING_EVIDENCE。",
    "",
    "三个领域的分析结果：",
    analyses.join("\n\n---\n\n")
  ].join("\n"),
  { label: "synthesize", phase: "synthesize" }
);

return {
  ip: args.ip,
  summary: args.evidence.summary,
  deterministic_diagnosis: args.evidence.diagnosis || null,
  analyses,
  synthesis
};
