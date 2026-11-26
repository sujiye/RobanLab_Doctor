'use strict';
/**
 * visual-evidence —— 收集图片/手机 capture，并为视觉模型准备结构化提示。
 *
 * 本 skill 不做图像识别；它假设调用它的 agent 具备视觉能力，
 * 由 agent 看图后填写 observations（可见事实 + 不确定性），再传给归因层。
 */

const fsDefault = require('fs');
const path = require('path');

const id = 'visual-evidence';
const title = '视觉证据收集';
const description = '校验图片/手机 capture，输出视觉提示和 observations 结构';
const inputs = {
  images: 'array，图片路径或 {path,label,capturedAt}',
  captures: 'array，手机测量页保存的 capture JSON 路径',
  visionObservations: 'object|string|null，视觉模型看图后的结构化观察'
};

const VISION_SCHEMA = {
  scene: '整体画面：机器人姿态、支撑方式、周围环境、拍摄角度',
  robotPose: '机器人当前姿态：站立/坐/吊挂/手臂位置',
  affectedPart: '异常部位',
  joints: '可见关节/连杆的相对位置或明显偏斜（没有把握就写不确定）',
  cables: '线缆是否插好、是否被拉扯、是否有破损',
  connectors: '接头/端子是否松动、脱落、发热痕迹',
  leds: '指示灯颜色/闪烁（如有）',
  screenText: '屏幕/终端可见报错原文（如有）',
  damage: '可见的机械损伤、变形、异物、液体',
  environment: '桌面/地面/障碍物/光照等可能影响判断的因素',
  visibleFacts: '只描述画面中确实看到的事实，数组',
  uncertainties: '看不清、被遮挡、无法从图片判断的内容，数组'
};

const VISION_PROMPT = [
  '请查看用户提供的图片/截图，只提取画面中确实可见的事实，不要猜测不可见的结构。',
  '按以下 JSON 结构输出 observations：',
  JSON.stringify(VISION_SCHEMA, null, 2),
  '要求：',
  '- visibleFacts 只写看见的内容；不确定的内容放 uncertainties；',
  '- 不要仅凭图片断言“电机坏了/编码器坏了”，视觉只能支持“姿态异常/线缆脱落/屏幕报错”等可见事实；',
  '- 如果图片角度、遮挡或分辨率不足以判断，明确写出来。'
].join('\n');

function normalizeImage(item) {
  if (typeof item === 'string') return { path: item, label: path.basename(item) };
  if (item && typeof item === 'object' && item.path) {
    return { path: item.path, label: item.label || path.basename(item.path), capturedAt: item.capturedAt || null };
  }
  return null;
}

function extOf(file) {
  return path.extname(file).toLowerCase();
}

async function run(ctx, {
  images = [],
  captures = [],
  visionObservations = null
} = {}) {
  const fs = ctx.fs || fsDefault;
  const imageItems = [];
  const captureItems = [];
  const missing = [];

  for (const item of images || []) {
    const normalized = normalizeImage(item);
    if (!normalized) continue;
    const abs = path.isAbsolute(normalized.path) ? normalized.path : path.resolve(process.cwd(), normalized.path);
    if (!fs.existsSync(abs)) {
      missing.push(`图片不存在：${normalized.path}`);
      continue;
    }
    const stat = fs.statSync(abs);
    imageItems.push({
      ...normalized,
      path: abs,
      bytes: stat.size,
      ext: extOf(abs)
    });
  }

  for (const file of captures || []) {
    const abs = path.isAbsolute(file) ? file : path.resolve(process.cwd(), file);
    if (!fs.existsSync(abs)) {
      missing.push(`capture 不存在：${file}`);
      continue;
    }
    try {
      const data = JSON.parse(fs.readFileSync(abs, 'utf8'));
      captureItems.push({
        captureFile: abs,
        imageFile: data.imageFile || null,
        angleDeg: data.angleDeg,
        referenceAngleDeg: data.referenceAngleDeg,
        linkAngleDeg: data.linkAngleDeg,
        note: data.note || '',
        createdAt: data.createdAt || null
      });
      if (data.imageFile && fs.existsSync(data.imageFile)) {
        const stat = fs.statSync(data.imageFile);
        imageItems.push({
          path: data.imageFile,
          label: path.basename(data.imageFile),
          capturedAt: data.createdAt || null,
          bytes: stat.size,
          ext: extOf(data.imageFile)
        });
      }
    } catch (err) {
      missing.push(`capture 解析失败：${path.basename(abs)} (${err.message})`);
    }
  }

  const ready = imageItems.length > 0;
  if (!ready) missing.push('没有可用图片；请拍照/上传后再做视觉判断。');
  const hasObservations = Boolean(visionObservations && (
    typeof visionObservations === 'object' ? Object.keys(visionObservations).length : String(visionObservations).trim()
  ));
  if (ready && !hasObservations) {
    missing.push('已有图片，但还没有视觉模型填写的 observations；请先看图并填写。');
  }

  const visualEvidence = {
    images: imageItems,
    captures: captureItems,
    visionObservations: visionObservations || null,
    hasObservations,
    ready,
    missing,
    visionPrompt: VISION_PROMPT,
    visionSchema: VISION_SCHEMA
  };

  ctx.log(
    `[visual] images=${imageItems.length} captures=${captureItems.length} ` +
    `observations=${hasObservations} ready=${ready}`
  );
  return { state: { visualEvidence }, visualEvidence };
}

module.exports = {
  id, title, description, inputs, run,
  VISION_SCHEMA, VISION_PROMPT, normalizeImage
};
