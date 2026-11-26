#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成技术调研报告所需的三张示意图（PNG）。零依赖，仅用 Pillow。"""

from PIL import Image, ImageDraw, ImageFont

FONT = "/System/Library/Fonts/Hiragino Sans GB.ttc"
OUT = "/Users/sujiye/Documents/大三上/智能交互机器人实验/final/docs_figures"

INK = (30, 40, 55)
MUTE = (102, 116, 132)
LINE = (160, 175, 192)
BOX_A = (244, 248, 252)
BOX_B = (232, 241, 250)
ACCENT = (30, 90, 150)
ACCENT2 = (176, 90, 40)
OK = (60, 130, 90)


def font(size, bold=False):
    idx = 1 if bold else 0
    try:
        return ImageFont.truetype(FONT, size, index=idx)
    except Exception:
        return ImageFont.truetype(FONT, size, index=0)


def rounded(d, x, y, w, h, fill, outline=LINE, r=8):
    d.rounded_rectangle([x, y, x + w, y + h], radius=r, fill=fill, outline=outline, width=2)


def text(d, x, y, s, f, fill=INK, center=False, width=None):
    if center and width is not None:
        w = d.textlength(s, font=f)
        x = x + (width - w) / 2.0
    d.text((x, y), s, font=f, fill=fill)


def arrow(d, x1, y1, x2, y2, color=ACCENT, width=2, label=None, f=None):
    d.line([(x1, y1), (x2, y2)], fill=color, width=width)
    if x2 > x1:
        d.polygon([(x2, y2), (x2 - 10, y2 - 5), (x2 - 10, y2 + 5)], fill=color)
    elif y2 > y1:
        d.polygon([(x2, y2), (x2 - 5, y2 - 10), (x2 + 5, y2 - 10)], fill=color)
    else:
        d.polygon([(x2, y2), (x2 - 5, y2 + 10), (x2 + 5, y2 + 10)], fill=color)
    if label and f:
        text(d, (x1 + x2) / 2, (y1 + y2) / 2 - 14, label, f, MUTE, center=True)


# ---------------------------------------------------------------- Figure 1
def figure1():
    W, H = 1400, 900
    img = Image.new("RGB", (W, H), (255, 255, 255))
    d = ImageDraw.Draw(img)
    f_title = font(26, True)
    f_box = font(17, True)
    f_txt = font(13)
    f_small = font(12)

    text(d, 24, 14, "图 1  RobanLab Doctor 目标总体架构（P0 主线 + 后续扩展）", f_title, ACCENT)

    # 1. browser
    rounded(d, 60, 60, 620, 90, BOX_A)
    text(d, 76, 72, "学生端：浏览器 Web 工作台（React + TypeScript + Vite + Ant Design）", f_box)
    text(d, 76, 96, "诊断工作台 / 预检结果 / 修复审查(diff) / 运动测试与 3D 预演 / 报告与历史", f_small, MUTE)

    rounded(d, 720, 60, 620, 90, BOX_A)
    text(d, 736, 72, "凭证与密钥边界", f_box)
    text(d, 736, 96, "SSH 密钥、DeepSeek API Key 仅后端持有；浏览器不直接执行 SSH", f_small, MUTE)

    # 2. backend
    rounded(d, 60, 190, 1280, 120, BOX_B)
    text(d, 76, 202, "后端服务层：FastAPI（REST + WebSocket/SSE）+ SQLite 任务/证据/审计库", f_box)
    text(d, 76, 228, "任务状态机：created → contextualizing → inspecting → analyzing → repairing/testing → verifying → completed/incomplete/failed", f_small, MUTE)
    arrow(d, 370, 150, 370, 190)
    arrow(d, 1030, 150, 1030, 190)

    # 3. core modules
    mods = [
        (60, "诊断 Workflow\n固定主干 S0–S7", "顺序/分支/停机条件\n人工暂停与重试上限"),
        (330, "DeepSeek Agent\n理解与推理", "症状理解·工具选择\n证据解释·不确定性"),
        (600, "规则引擎\nYAML 确定性规则", "证据 → 结论/后续动作\n禁止动作显式声明"),
        (870, "安全与权限网关\nR0–R3 + 审批", "白名单/路径/超时\n逐次审批·审计留痕"),
        (1140, "课程知识库 / RAG\n结构化 + 全文 + 案例", "来源·版本·适用性\n不替代实机证据"),
    ]
    for x, head, sub in mods:
        rounded(d, x, 350, 250, 110, BOX_A)
        text(d, x + 12, 362, head, f_box)
        text(d, x + 12, 392, sub, f_small, MUTE)
    arrow(d, 370, 310, 370, 350)

    rounded(d, 60, 490, 1330, 70, BOX_A)
    text(d, 76, 502, "证据数据层（Evidence Layer）：统一 evidence_id / source_type / source_interface / value / unit / validity / freshness / side_effect_class / raw_ref", f_box)
    arrow(d, 370, 460, 370, 490)
    arrow(d, 700, 460, 700, 490)
    arrow(d, 1020, 460, 1020, 490)

    rounded(d, 60, 585, 1330, 60, (250, 246, 236))
    text(d, 76, 596, "传输层：Paramiko SSH（受控命令模板 + 超时 + 输出限长 + 路径白名单）", f_box)
    arrow(d, 700, 560, 700, 585)

    rounded(d, 60, 670, 1330, 100, BOX_B)
    text(d, 76, 682, "机器人端适配器 robot_adapter（Roban 本机，ROS Kinetic 兼容）", f_box)
    text(d, 76, 708, "system_probe | ros_probe | bodyhub_probe | sensor_probe | motion_executor(仅已批准轨迹) | safety_checks | protocol(JSON)", f_small, MUTE)
    arrow(d, 700, 645, 700, 670)

    rounded(d, 60, 795, 1330, 80, (240, 246, 250))
    text(d, 76, 806, "Roban 机器人：lemon-NUC8i3BEH / Ubuntu 16.04 / ROS Kinetic / BodyHub(bodyhub_new) / 22 舵机 / 相机 / IMU / 电池", f_box)
    arrow(d, 700, 770, 700, 795)

    img.save(f"{OUT}/fig1_architecture.png")


# ---------------------------------------------------------------- Figure 2
def figure2():
    W, H = 1400, 620
    img = Image.new("RGB", (W, H), (255, 255, 255))
    d = ImageDraw.Draw(img)
    f_title = font(26, True)
    f_box = font(16, True)
    f_small = font(12)

    text(d, 24, 14, "图 2  诊断主干（S0–S7）与四类故障分流", f_title, ACCENT)

    stages = ["S0 上下文", "S1 运行环境", "S2 ROS/BodyHub", "S3 指令链路", "S4 设备观测", "S5 标准运动测试", "S6 修复与复测", "S7 报告留痕"]
    x = 60
    y = 90
    for i, s in enumerate(stages):
        w = 150
        rounded(d, x, y, w, 52, BOX_A)
        text(d, x, y + 16, s, f_box, INK, center=True, width=w)
        if i < len(stages) - 1:
            arrow(d, x + w, y + 26, x + w + 20, y + 26)
        x += w + 20
    text(d, 60, 150, "条件跳转：明确 SyntaxError 直接进 S6；ROS Master 不可达则禁止任何运动测试；软件链路已解释故障时不再触发物理动作。", f_small, MUTE)

    # evidence four layers
    rounded(d, 60, 200, 640, 180, BOX_B)
    text(d, 76, 212, "四类证据不可互相替代", f_box)
    rows = [
        ("① 平台命令/目标角", "发出 ≠ 控制器接受"),
        ("② 控制器软件缓存", "缓存角 ≠ 电机实测位置"),
        ("③ 舵机反馈(编码器)", "编码器变化 ≠ 机械输出位移"),
        ("④ 现场人工观察", "主观观察需保留不确定性"),
    ]
    yy = 244
    for a, b in rows:
        text(d, 80, yy, a, font(13), INK)
        text(d, 260, yy, b, f_small, MUTE)
        yy += 32

    # categories
    rounded(d, 740, 200, 600, 180, (246, 250, 254))
    text(d, 756, 212, "输出结论必须带证据与边界", f_box)
    cats = [
        ("student_software", "学生代码问题 → 备份 + 补丁 + 复测", OK),
        ("robot_software", "机器人软件环境问题 → 受控恢复 + 复测", ACCENT),
        ("suspected_device", "疑似设备侧异常 → 建议换机 / 联系教师", ACCENT2),
        ("insufficient_evidence", "证据不足 → 列缺失证据，不下结论", MUTE),
    ]
    yy = 244
    for name, desc, color in cats:
        text(d, 760, yy, name, font(13, True), color)
        text(d, 960, yy, desc, f_small, MUTE)
        yy += 32

    rounded(d, 60, 410, 1280, 90, (250, 246, 236))
    text(d, 76, 422, "安全闸门（不可被 Agent 绕过）：R0 经验证只读 → R1 有界学生代码修复 → R2 系统级变更(需确认+回滚) → R3 物理动作/标定(逐次确认 + 机器人端独立停止)", f_box)
    text(d, 76, 450, "运动测试状态闸门：draft → mapping_checked → simulation_checked → hardware_approved → enabled；断开 SSH ≠ 安全停止。", f_small, MUTE)

    img.save(f"{OUT}/fig2_workflow.png")


# ---------------------------------------------------------------- Figure 3
def figure3():
    W, H = 1400, 520
    img = Image.new("RGB", (W, H), (255, 255, 255))
    d = ImageDraw.Draw(img)
    f_title = font(26, True)
    f_box = font(15, True)
    f_small = font(12)

    text(d, 24, 14, "图 3  里程碑 M0–M7：已完成 / 部分完成 / 未启动（按现有代码事实判定）", f_title, ACCENT)

    rows = [
        ("M0 能力与接口核对", "实机快照、接口副作用、关节映射、停止策略", "部分完成"),
        ("M1 连接与基础自检", "SSH + 只读 probe + 规则化 selfcheck + 报告", "基本完成(无 Web)"),
        ("M2 确定性诊断规则", "23 项检查 → 5 故障单元归并 + 严重度分级", "基本完成"),
        ("M3 Agent 与受控修复", "白名单动作 dry-run/--confirm + 复测 + 回滚", "部分完成"),
        ("M4 课程知识检索", "种子案例 + 谓词匹配 + 复发冷却 + degraded", "部分完成(无 RAG)"),
        ("M5 标准运动测试 V1", "用例注册表 / 3D 预演 / 机器人端执行器", "未启动"),
        ("M6 诊断融合与人工确认", "自然语言症状 + 视觉观察 + 推荐测试", "部分完成"),
        ("M7 扩展与验收", "22 关节覆盖、调参、回归测试集 D01–D15", "未启动"),
    ]
    y = 80
    for i, (name, desc, status) in enumerate(rows):
        rounded(d, 60, y, 1280, 44, BOX_A if i % 2 == 0 else BOX_B)
        text(d, 76, y + 12, name, f_box)
        text(d, 380, y + 14, desc, f_small, MUTE)
        color = OK if "基本完成" in status else (ACCENT if "部分完成" in status else ACCENT2)
        text(d, 1150, y + 14, status, font(13, True), color)
        y += 50

    img.save(f"{OUT}/fig3_gap.png")


figure1()
figure2()
figure3()
print("figures written")
