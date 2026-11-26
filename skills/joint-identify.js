'use strict';
/**
 * joint-identify —— 通过“手动大幅转动一个关节 + 前后实测角对比”识别关节 ID。
 *
 * 流程：
 *   baseline：刷新并读取 22 个关节，保存基线
 *   用户手动大幅转动其中一个关节
 *   diff：再次刷新读取，按变化量排序，识别关节 ID
 *   用户把该关节手动放到正确零点
 *   zero：再次刷新读取，返回该关节的软件角度（候选修正量 = -角度）
 *
 * 每次读取都需要用户批准的控制读（refresh-joint-positions）。
 */

const fsDefault = require('fs');
const path = require('path');
const jointPositions = require('./joint-positions.js');

const id = 'joint-identify';
const title = '手动转动识别关节 ID + 零点读取';
const description = 'baseline/diff/zero 三阶段；不运动，只做用户批准的状态机刷新读';
const inputs = {
  phase: 'baseline | diff | zero',
  controlApproved: 'boolean，用户是否批准这次控制读',
  jointId: 'number|null，zero 阶段可显式指定',
  expectedZero: 'number，默认 0',
  stateDir: 'string，默认 ./calibration/state'
};

const MIN_MOVE_DEG = 1.5;
const AMBIGUITY_RATIO = 0.6;

function stateDirOf(ctx, provided) {
  return provided || (ctx && ctx.calibrationDir
    ? path.join(ctx.calibrationDir, 'state')
    : path.join(process.cwd(), 'calibration', 'state'));
}

function readJson(fs, file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function writeJson(fs, file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function computeCandidates(before, after) {
  const n = Math.min(before.length, after.length);
  const deltas = [];
  for (let i = 0; i < n; i += 1) {
    const delta = Number((after[i] - before[i]).toFixed(4));
    deltas.push({ jointId: i + 1, delta, absDelta: Number(Math.abs(delta).toFixed(4)) });
  }
  deltas.sort((a, b) => b.absDelta - a.absDelta);
  return deltas;
}

async function run(ctx, {
  phase = 'baseline',
  controlApproved = false,
  jointId = null,
  expectedZero = 0,
  stateDir
} = {}) {
  const fs = ctx.fs || fsDefault;
  const dir = stateDirOf(ctx, stateDir);
  const baselineFile = path.join(dir, 'joint-baseline.json');
  const identifiedFile = path.join(dir, 'joint-identified.json');
  const zeroFile = path.join(dir, 'joint-zero.json');

  if (phase === 'baseline') {
    const read = await jointPositions.refreshAndRead(ctx, { controlApproved });
    if (read.status !== 'ok') {
      return { state: { jointIdentify: read }, ...read };
    }
    const saved = { at: new Date().toISOString(), values: read.values };
    writeJson(fs, baselineFile, saved);
    ctx.log(`[joint-identify] baseline saved ${baselineFile}`);
    return {
      state: { jointIdentify: { phase, status: 'baseline_saved', file: baselineFile, values: read.values } },
      phase,
      status: 'baseline_saved',
      file: baselineFile,
      values: read.values
    };
  }

  if (phase === 'diff') {
    const baseline = readJson(fs, baselineFile);
    if (!baseline || !Array.isArray(baseline.values)) {
      return {
        state: { jointIdentify: { phase, status: 'need_baseline' } },
        phase,
        status: 'need_baseline',
        message: '先运行 baseline，再让用户手动转动一个关节。'
      };
    }
    const read = await jointPositions.refreshAndRead(ctx, { controlApproved });
    if (read.status !== 'ok') {
      return { state: { jointIdentify: read }, ...read };
    }
    const candidates = computeCandidates(baseline.values, read.values).slice(0, 5);
    const top = candidates[0];
    const second = candidates[1];
    let status = 'identified';
    let message = '';
    if (!top || top.absDelta < MIN_MOVE_DEG) {
      status = 'no_clear_motion';
      message = `最大变化只有 ${top ? top.absDelta : 0}°，请确认关节已解锁/可自由转动，并再大幅转动一次。`;
    } else if (second && second.absDelta > top.absDelta * AMBIGUITY_RATIO) {
      status = 'ambiguous';
      message = '多个关节同时变化，无法唯一识别；请只转动一个关节，必要时重新做 baseline。';
    } else {
      message = `识别到 ID${top.jointId}，变化 ${top.delta}°。`;
    }
    const saved = {
      at: new Date().toISOString(),
      status,
      jointId: status === 'identified' ? top.jointId : null,
      delta: status === 'identified' ? top.delta : null,
      candidates,
      baselineFile
    };
    writeJson(fs, identifiedFile, saved);
    ctx.log(`[joint-identify] diff status=${status} candidates=${candidates.map((c) => `ID${c.jointId}:${c.delta}`).join(',')}`);
    return {
      state: { jointIdentify: { phase, ...saved, message } },
      phase,
      ...saved,
      message
    };
  }

  if (phase === 'zero') {
    const identified = readJson(fs, identifiedFile);
    const targetId = Number(jointId || (identified && identified.jointId));
    if (!Number.isInteger(targetId) || targetId < 1 || targetId > 22) {
      return {
        state: { jointIdentify: { phase, status: 'need_identification' } },
        phase,
        status: 'need_identification',
        message: '先运行 diff 识别关节 ID，或用 jointId 显式指定。'
      };
    }
    const read = await jointPositions.refreshAndRead(ctx, { controlApproved });
    if (read.status !== 'ok') {
      return { state: { jointIdentify: read }, ...read };
    }
    const zeroAngle = read.values[targetId - 1];
    if (!Number.isFinite(zeroAngle)) {
      return {
        state: { jointIdentify: { phase, status: 'read_failed', jointId: targetId } },
        phase,
        status: 'read_failed',
        jointId: targetId,
        message: `没有读到 ID${targetId} 的角度，请检查 ScanServo/总线后重试。`
      };
    }
    const expected = Number(expectedZero) || 0;
    const delta = Number((zeroAngle - expected).toFixed(4));
    const result = {
      phase,
      status: 'zero_captured',
      jointId: targetId,
      zeroAngle,
      expectedZero: expected,
      delta,
      correctionSign: -1,
      values: read.values,
      at: new Date().toISOString()
    };
    writeJson(fs, zeroFile, result);
    ctx.log(`[joint-identify] zero ID${targetId} angle=${zeroAngle} delta=${delta} sign=-1`);
    return { state: { jointIdentify: result }, ...result };
  }

  throw new Error('phase 必须是 baseline / diff / zero');
}

module.exports = {
  id, title, description, inputs, run,
  computeCandidates, MIN_MOVE_DEG, AMBIGUITY_RATIO
};
