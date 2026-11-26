# calibration —— 零位标定产物

这个目录存放 `roban-zero-calibration` workflow 生成的本地文件：

```text
calibration/
├── captures/   # 手机相机页面提交的图片和 JSON（角度、备注、时间）
├── backups/    # 读取到的原始 offset 文件备份
├── patches/    # 候选 offset 的文本补丁
├── scripts/    # 人工 apply 脚本（不会被 agent 自动执行）
└── reports/    # 标定记录 Markdown
```

## 重要边界

- `scripts/*.sh` 只修改机器人上的 offset 文件并备份；**不会**重启 BodyHub、
  不会让关节上电/卸力、不会移动关节。
- apply 脚本必须由用户手动复制到机器人并运行。
- 运行 apply 后，必须由用户手动重启 BodyHub（或按厂家流程重新加载 offset）。
- agent 不会自动写 `offset.yaml`、不会自动重启、不会执行任何运动。
- 手机相机只是人工测量辅助：手机要固定，画面里要有基座参考线/标记；
  手持单张照片不能作为绝对零位真值。

## 手机测量

```bash
node tools/phone-camera/server.js
```

手机和电脑在同一 Wi-Fi 下，打开终端打印的 `http://<局域网IP>:8787`。
拍照后依次标“基座参考线”和“连杆方向”，页面计算相对角度并提交；
workflow 可用生成的 `captures/capture-*.json` 作为 `--capture` 输入。

## 不知道关节 ID 时：手动转动识别

```bash
# 1) 基线（用户批准控制读）
ROBAN_HOST=<ROBOT_IP> node workflow/joint-identify-adapter.js baseline --control-approved

# 2) 手动大幅转动一个关节，然后识别
ROBAN_HOST=<ROBOT_IP> node workflow/joint-identify-adapter.js diff --control-approved

# 3) 手动把该关节放到正确零点，读取软件角度
ROBAN_HOST=<ROBOT_IP> node workflow/joint-identify-adapter.js zero --joint 7 --control-approved
```

控制读只做 `StateJump setStatus → reset` 触发实测位置刷新，不运动、不改扭矩；
必须逐次得到用户批准，并且在 `preReady`、`masterID=0`、机器人已支撑时执行。

## 标定流程

```bash
# 人工/手机测量 → 生成候选 offset、备份、patch、apply 脚本
ROBAN_HOST=<ROBOT_IP> node workflow/calibrate-adapter.js calibrate \
  --joint 7 --layer pose --expected-angle 0 --actual-angle 3.2 --sign 1

# 用户手动运行 calibration/scripts/apply-offset-*.sh 并手动重启 BodyHub

# 复检 offset 文件；仍需人工视觉确认
ROBAN_HOST=<ROBOT_IP> node workflow/calibrate-adapter.js calibrate-verify \
  --joint 7 --expected-offset 8.2
```
