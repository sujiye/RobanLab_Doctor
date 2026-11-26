# Roban 经验知识库（KB）

本目录存放「故障签名 → 修复剧本 → 复检判据」的经验，供 `workflow/auto-repair` 在检测后检索。
官方手册（使用入门 / 教员培训 / 自检 / 零点 / 拆机 / 版本查询 / 镜像刷新 / 开机故障 /
ROS 节点清单）在 `knowledge/`：本 KB 存**我们习得的经验**，`knowledge/` 存**官方原文与抽取文本**。
查「官方怎么做」时读 `knowledge/INDEX.md`。
知识库只保存**经验**，不保存任意命令：剧本里的每个 action 必须命中 `skills/repair.js` 的
白名单，否则加载时被判为无效、不会执行。

## 隐私规则（强制，见 `ATTENTION/ATTENTION.md` 规则 1）

- **不得记录机器人 IP**：`cases/*.json`、`events.jsonl`、自动习得案例、证据快照、备注都不写 IP。
- 读写时由 `skills/safety.js` 做 IP 脱敏：IPv4 统一替换为 `[REDACTED_IP]`，
  `ip` / `host` / `hostname` / `address` 等字段直接置为 `[REDACTED_IP]`。
- `signature.predicates` 不得使用 IP/主机地址作为匹配条件；命中这类谓词的案例按无效处理。
- 读取知识库时**忽略**其中的 IP/主机字段，不得用 KB 里的地址连接机器人。
- 当前机器人 IP 必须来自用户在当前对话中的明确输入。

## 目录结构

```text
kb/
├── README.md                 # 本文：schema、匹配规则、写入规则
├── cases/                    # 一条经验一个 JSON 文件（seed=人工种子，learned=自动习得）
│   ├── camera-chin-startup-order.json
│   ├── servo-bus-intermittent-reads.json
│   ├── servo-temperature-zero-readings.json
│   ├── sensor-imu-no-data.json
│   └── sensor-sensorhub-no-data.json
└── events.jsonl              # 只追加的修复尝试日志（每次实际执行写一行）
```

- `cases/` 可人工编辑，也可被 `learn` skill 自动写入；**自动写入只新增/更新，不删除**。
- `events.jsonl` 是审计日志，用来回答「哪次、用什么剧本、结果如何」；分析趋势时优先看它。
- 环境变量 `ROBAN_KB_DIR` 可把知识库指向其他目录（测试、实验对比用）。

## 案例 schema（schemaVersion=1）

```json
{
  "schemaVersion": 1,
  "id": "camera-chin-startup-order",
  "title": "下巴相机节点启动顺序竞态：节点在 /dev/usb_cam 就绪前退出",
  "component": "camera.chin",
  "checkIds": ["camera_chin", "chin_camera_node", "dead_processes", "expected_nodes"],
  "signature": {
    "predicates": [
      { "path": "usbCam", "op": "eq", "value": "OK" },
      { "path": "chinCameraNode", "op": "eq", "value": "UNREACHABLE" }
    ],
    "keywords": ["chin_camera", "usb_cam", "下巴相机"]
  },
  "autoRepairable": true,
  "playbook": [
    { "action": "restart-chin-camera", "note": "重启后要求 /chin_camera/image ≥ 5 Hz 持续 5 秒" }
  ],
  "preconditions": {
    "bodyhubState": ["preReady", "pause"],
    "masterId": 0,
    "usbCam": "OK"
  },
  "verification": { "topic": "/chin_camera/image", "minHz": 5, "seconds": 5 },
  "cooldownMs": 900000,
  "stats": { "attempts": 0, "successes": 0, "failures": 0, "lastOutcome": null, "lastAttemptAt": null },
  "recurrences": 0,
  "lastRecurrence": null,
  "source": "seed",
  "notes": "证据、来源、人工确认过的结论",
  "createdAt": "2026-11-19T01:50:00.000Z",
  "updatedAt": "2026-11-19T01:50:00.000Z"
}
```

字段约定：

| 字段 | 说明 |
|---|---|
| `component` | 故障组件，必须与 `skills/fault-units.js` 的组件 id 一致 |
| `checkIds` | 该经验覆盖的自检项（来自 `selfcheck`），用于计算重合度 |
| `signature.predicates` | 对 `probe` 的谓词，**全部满足才算命中**；`path` 支持 `a.b.c` 取值 |
| `signature.keywords` | 在故障描述里出现则加分（中文/英文均可） |
| `autoRepairable` | `true` 才允许自动执行；`false` 只作为人工建议 |
| `playbook` | 有序步骤；每步 `{action, note?, retries?, retryDelayMs?}`；action 必须在白名单 |
| `preconditions` | 执行前必须成立的条件；不满足则计划标记 `blocked`，不执行 |
| `verification` | 修复后的复检判据（由 action 自己执行并返回） |
| `cooldownMs` | 修复成功后的冷却期；冷却期内同故障复发则阻止自动重启（默认 15 分钟） |
| `stats` | 自动累积：attempts / successes / failures / lastOutcome / lastAttemptAt |
| `recurrences` / `lastRecurrence` | 自动写入：冷却期内复发次数与最近一次证据（不是修复尝试，不计入 attempts） |
| `degraded` | 自动写入：同一经验连续失败 ≥2 次且从未成功时置 true，检索时跳过 |
| `source` | `seed`（人工种子）或 `learned`（自动习得） |

## 匹配与决策规则（`skills/kb.js`）

对每个「故障单元」（fault unit，按组件合并多条检查项）：

1. 候选必须 `component` 完全相同，且 `signature.predicates` 全部成立；
2. 打分：组件命中 0.5 + 检查项重合度 0.3 + 关键词命中率 0.2；
3. 取分数最高的候选；`degraded=true` 的经验视为「已知失败的旧办法」，跳过；
4. 若该经验刚成功过且仍在 `cooldownMs` 冷却期内、同故障却再次出现 → 计划标 `blocked`，
   记录 `recurrence` 事件并转人工（说明修复只是临时缓解，禁止自动重启循环）；
5. 命中且 `autoRepairable` 且前置条件成立 → **按知识库剧本修复**；
6. 未命中、命中但被跳过、或知识库剧本执行失败 → 进入**自行尝试**（`generated`）：
   使用组件定义的安全动作阶梯（当前只有非运动节点 `restart-chin-camera`，失败后重试一次）；
7. 仍然失败 → 标记 `failed`，写入事件日志；人工待办进入报告。

## 写入规则（`skills/learn.js` + `skills/kb.js`）

只有**实际执行**过的修复（`confirm=true`）才会写入：

- 每条实际尝试追加一行 `events.jsonl`，包含时间、组件、计划来源、剧本、尝试结果、
  目标检查项复检结果、是否有效（`effective`）；写入前自动做 IP 脱敏。
- 案例校验会拒绝包含 IP/主机地址的内容；加载时发现含 IP 的案例会脱敏并记录 warning。
- 命中知识库且成功 → 更新该案例 `stats.successes`、`lastOutcome`。
- 冷却期内复发 → 追加 `kind=recurrence` 事件，更新 `recurrences`/`lastRecurrence`，不增加 attempts。
- 命中知识库但失败 → 更新 `stats.failures`、`lastFailure`；连续失败 ≥2 次后标记 `degraded`。
- 知识库未命中（或命中失败后回退）且自行尝试成功 → 新建 `learned-<component>-<hash>` 案例，
  剧本取实际成功的那条路径；同一签名再次成功则合并统计。
- 报告标记成功但整体复检仍失败 → 记为 `unverified_success` / 无效，不增加成功计数。

## 扩展新经验

1. 确认故障组件 id 存在（`skills/fault-units.js` 的 `COMPONENTS`），不存在先加组件；
2. 新修复动作必须先加入 `skills/repair.js` 的 `ACTIONS` 白名单（含远端脚本、前置检查、复检）；
3. 再写 `cases/<id>.json`，或在真实执行成功后让 `learn` 自动生成；
4. 用 `node workflow/harness-adapter.example.js plan` 做 dry-run，确认命中与计划符合预期。
