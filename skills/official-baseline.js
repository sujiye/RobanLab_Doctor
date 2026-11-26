'use strict';
/**
 * official-baseline —— 把官方手册里的可判定基线（规格、版本判据、开机行为、零点、官方自检）
 * 与实测 probe 对照，输出「差异 + 出处 + 人工步骤」。
 *
 * 只读：不执行任何机器人命令。出处来自 knowledge/official-baseline.json
 * （由 knowledge/manuals/ 里的官方 PDF 抽取而来）。
 */

const fsDefault = require('fs');
const path = require('path');

const id = 'official-baseline';
const title = '官方基线对照（规格 / 版本 / 开机 / 零点 / 官方自检）';
const description = '返回 baseline、mismatches、officialSelfCheck、safetyNotes，全部带官方出处';
const inputs = {
  probe: 'env-probe 的输出对象',
  checks: 'selfcheck 的输出 checks[]',
  baselinePath: '可选，默认 knowledge/official-baseline.json'
};

const FALLBACK = {
  schemaVersion: 1,
  modelDetection: {
    byUbuntu: { '16.04': 'Roban 1.0', '20.04': 'Roban 2.0' },
    codeCutoverDate: '2023-11-29',
    citation: '《Roban机器人版本查询手册》p.1-2'
  },
  hardware: {
    jointCount: 22,
    realsense: 'Intel RealSense D435',
    chinCamera: 'USB 2592x1944',
    citation: '《ROBAN机器人使用入门》p.6-7'
  },
  bootBehavior: {
    lockAfterSeconds: 40,
    emergencyKeyEffect: '红色按键解锁全部舵机，主机仍运行',
    citation: '《ROBAN机器人使用入门》p.11-12；《Roban_教员培训手册》p.4'
  },
  officialSelfCheck: {
    command: 'check',
    startupScript: '~/robot_ros_application/scripts/start.sh',
    citation: '《Roban机器人自检手册》p.1-2；《Roban_教员培训手册》p.24'
  }
};

/**
 * 官方 topic/service 清单（《所有节点 topic 和 service 整理》p.1-3）。
 * 其中只有相机/电池/BodyHub 状态这类「常驻数据流」可以断言存在；
 * 其余是事件式或示例运行时才发布，缺失只记为 unknown，不判故障。
 */
const ALWAYS_ALIVE_TOPICS = [
  '/chin_camera/image',
  '/camera/color/image_raw',
  '/MediumSize/SensorHub/BatteryState',
  '/MediumSize/BodyHub/Status'
];

function loadTopicMap(fsObj) {
  const file = path.join(__dirname, '..', 'knowledge', 'manuals', 'topics-services.json');
  try {
    const data = JSON.parse(fsObj.readFileSync(file, 'utf8'));
    return { path: file, data };
  } catch (err) {
    return { path: file, data: null, warning: err.message };
  }
}

function compareTopicMap(probe, topicMap) {
  if (!topicMap || !Array.isArray(topicMap.nodes)) return [];
  const actual = new Set((probe.topics && probe.topics.all) || []);
  if (!actual.size) return [];

  const gaps = [];
  for (const node of topicMap.nodes) {
    for (const pub of node.publications || []) {
      const topic = pub.topic;
      if (!topic || actual.has(topic)) continue;
      gaps.push({
        node: node.node,
        topic,
        purpose: pub.purpose || '',
        alwaysAlive: ALWAYS_ALIVE_TOPICS.includes(topic)
      });
    }
  }
  return gaps;
}

function loadBaseline(fsObj, baselinePath) {
  const file = baselinePath || path.join(__dirname, '..', 'knowledge', 'official-baseline.json');
  try {
    const data = JSON.parse(fsObj.readFileSync(file, 'utf8'));
    return { path: file, data, source: 'file' };
  } catch (err) {
    return { path: file, data: FALLBACK, source: 'fallback', warning: err.message };
  }
}

/**
 * 逐条对照：只写「有证据的差异」，没有证据的写 unknown，不臆测。
 */
function compare(probe, baseline, topicMap) {
  const mismatches = [];
  const add = (item, status, statement, citation, evidence) => {
    mismatches.push({ item, status, statement, citation, evidence: evidence || null });
  };

  const hw = baseline.hardware || {};
  const boot = baseline.bootBehavior || {};
  const models = baseline.modelDetection || {};

  // 1) 机型与 ROS 环境是否一致
  const model = probe.robotModel || 'UNKNOWN';
  if (model === 'UNKNOWN') {
    add('机型识别', 'unknown', 'lsb_release 无输出，无法判断 Roban 1.0 还是 2.0', models.citation || FALLBACK.modelDetection.citation);
  } else {
    add('机型识别', 'ok', `实测机型 ${model}（${probe.osRelease || ''}，ROS ${probe.rosDistro || '未知'}）`, models.citation || FALLBACK.modelDetection.citation, { osRelease: probe.osRelease, rosDistro: probe.rosDistro });
  }

  if (model === 'Roban 1.0' && probe.rosDistro && probe.rosDistro !== 'kinetic') {
    add('ROS 版本与机型', 'warn', `官方规格 Roban 1.0 使用 ROS Kinetic，实测为 ${probe.rosDistro}`, '《ROBAN机器人使用入门》p.6；《版本查询手册》p.2', { rosDistro: probe.rosDistro });
  }

  // 2) 代码新鲜度（官方阈值 2023-11-29）
  const cutover = models.codeCutoverDate || '2023-11-29';
  if (probe.repo && probe.repo.commitDate) {
    const outdated = probe.repo.commitDate < cutover;
    add('代码新鲜度', outdated ? 'warn' : 'ok',
      outdated
        ? `仓库提交时间 ${probe.repo.commitDate} 早于官方阈值 ${cutover}，需人工执行更新脚本`
        : `仓库提交时间 ${probe.repo.commitDate}，符合官方要求`,
      models.citation || FALLBACK.modelDetection.citation,
      { commitDate: probe.repo.commitDate, commit: probe.repo.commit });
  } else {
    add('代码新鲜度', 'unknown', '无法读取代码仓库时间（git 不可用或仓库不存在）', models.citation || FALLBACK.modelDetection.citation);
  }

  // 3) 关节数量（官方 22 个：头2、肩1×2、臂2×2、爪1×2、腿5×2、脚1×2）
  if (hw.jointCount) {
    if (probe.jointCount === hw.jointCount) {
      add('关节数量', 'ok', `GetJointAngle 返回 ${probe.jointCount} 个关节，与官方规格一致`, hw.citation || FALLBACK.hardware.citation);
    } else if (probe.jointCount > 0) {
      add('关节数量', 'warn', `实测 ${probe.jointCount} 个关节，官方规格为 ${hw.jointCount} 个`, hw.citation || FALLBACK.hardware.citation, { count: probe.jointCount });
    } else {
      add('关节数量', 'unknown', '未读到关节缓存，无法与官方 22 个关节对照', hw.citation || FALLBACK.hardware.citation);
    }
  }

  // 4) 相机硬件（官方规格 RealSense D435 + USB 下巴相机）
  add('深度相机硬件', probe.usb && probe.usb.realsense === 'OK' ? 'ok' : 'warn',
    probe.usb && probe.usb.realsense === 'OK'
      ? 'lsusb 看到 RealSense 设备，与官方规格一致'
      : 'lsusb 未看到 RealSense；若同时 camera_color 无数据，先查 USB3 线缆与供电',
    hw.citation || FALLBACK.hardware.citation,
    { usbDeviceCount: probe.usb && probe.usb.deviceCount });

  // 5) 开机行为与宽限期
  if (probe.uptimeSeconds !== null && probe.uptimeSeconds !== undefined) {
    const grace = boot.lockAfterSeconds || 40;
    add('开机宽限期', probe.uptimeSeconds < grace * 2 ? 'warn' : 'ok',
      probe.uptimeSeconds < grace * 2
        ? `开机 ${probe.uptimeSeconds} s，官方说明上电约 ${grace} s 后舵机加锁并恢复初始站立姿态；此时节点/话题缺失不能直接判故障`
        : `开机 ${probe.uptimeSeconds} s，基线判定有效`,
      boot.citation || FALLBACK.bootBehavior.citation,
      { uptimeSeconds: probe.uptimeSeconds });
  } else {
    add('开机宽限期', 'unknown', '无法读取运行时长', boot.citation || FALLBACK.bootBehavior.citation);
  }

  // 6) 零点备份（官方：镜像刷新前必须保存零点）
  const zp = probe.zeroPoint || {};
  add('零点备份', zp.officialOffset === 'OK' ? 'ok' : 'warn',
    zp.officialOffset === 'OK'
      ? `零点参数文件存在（~/.lejuconfig/offset.yaml，${zp.officialOffsetLines || 0} 行）`
      : '找不到 ~/.lejuconfig/offset.yaml：官方要求镜像刷新前先备份零点，缺失则无法恢复零点',
    '《Roban查零点步骤》p.1；《Roban_教员培训手册》p.37',
    { stairOffset: zp.stairOffset });

  // 7) 开机自启
  const boot2 = probe.boot || {};
  add('节点自启脚本', boot2.startScript === 'OK' ? 'ok' : 'warn',
    boot2.startScript === 'OK'
      ? '官方 start.sh 存在，开机默认调用它启动所有节点'
      : '缺少 ~/robot_ros_application/scripts/start.sh，节点不会开机自启（人工核对路径，agent 不自动执行）',
    '《Roban_教员培训手册》p.59-60',
    { roscoreProcs: boot2.roscoreProcs });

  // 8) 磁盘（官方规格 120G SSD）
  if (probe.diskUsedPct !== null && probe.diskUsedPct !== undefined) {
    add('磁盘占用', probe.diskUsedPct >= 95 ? 'fail' : probe.diskUsedPct >= 85 ? 'warn' : 'ok',
      `根分区使用率 ${probe.diskUsedPct}%（官方规格 120G SSD，镜像与日志占用需留意）`,
      '《ROBAN机器人使用入门》p.6',
      { diskUsedPct: probe.diskUsedPct });
  }

  // 9) 电池（官方 4000mAh 11.1V 3S）
  if (probe.battery && probe.battery.voltage !== null) {
    const v = probe.battery.voltage;
    add('电池电压', v < 10.8 ? 'fail' : v < 11.5 ? 'warn' : 'ok',
      `实测 ${v.toFixed(1)} V；官方电芯 11.1V 3S（满电约 12.6V，低于 10.8V 需充电）`,
      '《ROBAN机器人使用入门》p.7',
      { voltage: v, percentage: probe.battery.percentage });
  }

  // 10) 官方节点 topic 清单对照（《所有节点 topic 和 service 整理》p.1-3）
  const gaps = compareTopicMap(probe, topicMap);
  if (gaps.length) {
    const critical = gaps.filter((g) => g.alwaysAlive);
    const optional = gaps.filter((g) => !g.alwaysAlive);
    if (critical.length) {
      add('官方常驻数据流', 'warn',
        `官方清单里的常驻数据流没有出现在 rostopic 列表：${critical.map((g) => g.topic).join(', ')}（对应节点可能未启动）`,
        '《所有节点 topic 和 service 整理》p.1-3',
        { missing: critical.map((g) => ({ node: g.node, topic: g.topic, purpose: g.purpose })) });
    }
    if (optional.length) {
      add('官方事件式数据流', 'unknown',
        `官方清单中 ${optional.length} 个 topic 当前未出现（事件式或示例运行时才发布，不判故障）：` +
        optional.map((g) => g.topic).join(', '),
        '《所有节点 topic 和 service 整理》p.1-3',
        { missing: optional.map((g) => g.topic) });
    }
  } else if (probe.topics && probe.topics.all && probe.topics.all.length) {
    add('官方 topic 清单', 'ok', '官方清单中列出的 topic 均已在 rostopic 列表中出现', '《所有节点 topic 和 service 整理》p.1-3');
  }

  return mismatches;
}

function officialSelfCheckSteps(probe) {
  const steps = [];
  const checkPath = probe.officialCheck && probe.officialCheck.path;
  steps.push({
    step: '官方自检程序',
    detail: checkPath && checkPath !== 'MISSING'
      ? `机器人上存在官方自检程序（${checkPath}，${probe.officialCheck.size || 0} 字节）。需在 VNC/桌面终端交互运行：输入 check，逐项看编号报错并截图反馈。`
      : '未找到官方 check 程序；可用 VNC 接屏幕后在终端输入 check 确认。',
    citation: '《Roban机器人自检手册》p.1；《Roban_教员培训手册》p.24',
    agentRunsIt: false,
    reason: '官方程序需要交互输入，且可能启动节点；本 agent 只静态识别，不执行。'
  });
  steps.push({
    step: '官方程序覆盖项',
    detail: probe.officialCheck && probe.officialCheck.items && probe.officialCheck.items.length
      ? `静态识别到的自检项线索：${probe.officialCheck.items.join(', ')}`
      : '未能静态识别自检项名称（程序可能是二进制或路径不同）。',
    citation: '《Roban_教员培训手册》p.24（含脚底压感测试）',
    agentRunsIt: false
  });
  steps.push({
    step: '终端红字报错',
    detail: '官方要求开机或执行 ./start.sh 后查看终端是否有红字报错并截图。本 agent 用 rosout/roslaunch 日志中的 ERROR / "Unable to communicate with master" / "process has died" 做等价只读检查。',
    citation: '《Roban机器人自检手册》p.2；《Roban_教员培训手册》p.60',
    agentRunsIt: true
  });
  return steps;
}

function safetyNotes(baseline) {
  const boot = baseline.bootBehavior || {};
  return [
    {
      note: '红色按键是“舵机紧急解锁”，不是安全停止：按下后全部舵机解锁而主机仍运行，站立机器人会失去支撑。',
      citation: boot.citation || FALLBACK.bootBehavior.citation,
      action: '需要立即停止时：优先切断机器人电源（背部电源开关向左），或先由人工支撑/悬架固定机器人；断开 SSH 不等于停止。'
    },
    {
      note: '上电约 40 s 后全舵机加锁并恢复初始站立姿态；开机前要把机器人提至半蹲/站立初始姿态。',
      citation: boot.citation || FALLBACK.bootBehavior.citation,
      action: '检测时若机器人姿态异常，先人工确认支撑条件，再执行任何运动类操作。'
    },
    {
      note: '镜像刷新前必须保存零点参数；BIOS 的 After Power Failure 需设为 Power On。',
      citation: '《Roban机器人离线镜像刷新手册》p.1、p.12；《Roban_教员培训手册》p.22',
      action: '这两步只能人工完成，agent 不烧写镜像、不改 BIOS。'
    }
  ];
}

async function run(ctx, { probe, checks, baselinePath } = {}) {
  if (!probe) throw new Error('official-baseline 需要 probe');
  const fs = ctx.fs || fsDefault;
  const loaded = loadBaseline(fs, baselinePath);
  const topicMap = loadTopicMap(fs);
  const mismatches = compare(probe, loaded.data, topicMap.data);
  const steps = officialSelfCheckSteps(probe);
  const notes = safetyNotes(loaded.data);

  const counts = { ok: 0, warn: 0, fail: 0, unknown: 0 };
  for (const m of mismatches) counts[m.status] = (counts[m.status] || 0) + 1;

  ctx.log(
    `[official-baseline] 对照 ${mismatches.length} 项 ` +
    `(ok=${counts.ok} warn=${counts.warn} fail=${counts.fail} unknown=${counts.unknown})` +
    `${loaded.source === 'fallback' ? ' [使用内置兜底基线]' : ''}` +
    `${topicMap.data ? '' : ' [无 topic 清单]'}`
  );

  const baseline = {
    path: loaded.path,
    source: loaded.source,
    topicMapPath: topicMap.path,
    spec: loaded.data,
    mismatches,
    officialSelfCheck: steps,
    safetyNotes: notes,
    summary: counts
  };
  return { state: { baseline }, baseline, checks: checks || [] };
}

module.exports = { id, title, description, inputs, run, compare, compareTopicMap, loadBaseline, loadTopicMap };
