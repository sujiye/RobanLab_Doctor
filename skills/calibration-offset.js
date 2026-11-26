'use strict';
/**
 * calibration-offset —— 读取当前 offset、计算候选值、生成备份/补丁/apply 脚本。
 *
 * 本 skill 不写机器人上的 offset，不重启 BodyHub，不移动关节。
 * apply 脚本必须由用户在机器人上手动运行。
 */

const fsDefault = require('fs');
const path = require('path');
const sshRun = require('./ssh-run.js');
const { LAYER_PATH } = require('./calibration-plan.js');

const id = 'calibration-offset';
const title = '候选零位 offset 与人工补丁';
const description = '读取当前 offset，生成候选值、备份、patch 和人工 apply 脚本';
const inputs = {
  jointId: 'number，1–22',
  layer: 'pose 或 pack',
  delta: 'number，实际角度 - 期望角度',
  sign: 'number，1 或 -1',
  calibrationDir: 'string，默认 ./calibration'
};

function parseOffset(text, jointId) {
  const re = new RegExp(`^\\s*ID${jointId}\\s*:\\s*(-?\\d+(?:\\.\\d+)?)\\s*$`, 'm');
  const match = String(text).match(re);
  return match ? Number(match[1]) : null;
}

function round4(value) {
  return Number(Number(value).toFixed(4));
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

async function run(ctx, {
  jointId,
  layer = 'pose',
  delta,
  sign = 1,
  calibrationDir
} = {}) {
  const idNum = Number(jointId);
  if (!Number.isInteger(idNum) || idNum < 1 || idNum > 22) {
    throw new Error('jointId 必须是 1–22 的整数');
  }
  if (!LAYER_PATH[layer]) throw new Error('layer 只能是 pose 或 pack');
  const deltaNum = Number(delta);
  if (!Number.isFinite(deltaNum)) throw new Error('delta 必须是数字');
  const signNum = sign === -1 ? -1 : 1;

  const remotePath = LAYER_PATH[layer];
  const read = await sshRun.run(ctx, { command: `cat ${remotePath}` });
  if (read.code !== 0) {
    throw new Error(`读取 ${remotePath} 失败：${read.stderr.slice(-1000)}`);
  }

  const current = parseOffset(read.stdout, idNum);
  if (current === null) {
    throw new Error(`在 ${remotePath} 中找不到 ID${idNum} 的 offset 行`);
  }

  const candidate = round4(current + signNum * deltaNum);
  const warnings = [];
  if (Math.abs(candidate) > 360) {
    warnings.push(`候选 offset ${candidate} 超出 ±360°，请确认角度/方向/层是否选错。`);
  }

  const fs = ctx.fs || fsDefault;
  const baseDir = calibrationDir || path.join(process.cwd(), 'calibration');
  const stamp = timestamp();
  const backupDir = path.join(baseDir, 'backups');
  const patchDir = path.join(baseDir, 'patches');
  const scriptDir = path.join(baseDir, 'scripts');
  fs.mkdirSync(backupDir, { recursive: true });
  fs.mkdirSync(patchDir, { recursive: true });
  fs.mkdirSync(scriptDir, { recursive: true });

  const backupPath = path.join(backupDir, `offset-${layer}-${stamp}.yaml`);
  fs.writeFileSync(backupPath, read.stdout, 'utf8');

  const patchPath = path.join(patchDir, `offset-${layer}-ID${idNum}-${stamp}.patch`);
  const patch = [
    `--- ${remotePath}`,
    `+++ ${remotePath} (proposed)`,
    `@@ ID${idNum} @@`,
    `-  ID${idNum}: ${current}`,
    `+  ID${idNum}: ${candidate}`,
    ''
  ].join('\n');
  fs.writeFileSync(patchPath, patch, 'utf8');

  const applyScriptPath = path.join(scriptDir, `apply-offset-${layer}-ID${idNum}-${stamp}.sh`);
  const applyScript = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    `TARGET="${remotePath}"`,
    `BACKUP="\${TARGET}.bak-${stamp}"`,
    'cp "$TARGET" "$BACKUP"',
    `sed -i "s/^\\([[:space:]]*ID${idNum}[[:space:]]*:\\).*/\\1 ${candidate}/" "$TARGET"`,
    `echo "backup: $BACKUP"`,
    `grep -E "^[[:space:]]*ID${idNum}[[:space:]]*:" "$TARGET"`,
    'echo "offset applied. 现在请手动重启 BodyHub（或按厂家流程重新加载 offset），再运行 calibration-verify。"',
    ''
  ].join('\n');
  fs.writeFileSync(applyScriptPath, applyScript, { mode: 0o755 });
  try { fs.chmodSync(applyScriptPath, 0o755); } catch (_) { /* ignore */ }

  const result = {
    jointId: idNum,
    layer,
    remotePath,
    currentOffset: current,
    delta: deltaNum,
    sign: signNum,
    candidateOffset: candidate,
    warnings,
    backupPath,
    patchPath,
    applyScriptPath,
    applyCommand: `scp "${applyScriptPath}" lemon@<ROBOT_IP>:/tmp/ && ssh lemon@<ROBOT_IP> 'bash /tmp/${path.basename(applyScriptPath)}'`,
    policy: 'agent 不执行 apply；必须由用户手动运行并手动重启 BodyHub'
  };

  ctx.log(
    `[calibration-offset] ID${idNum} ${layer}: ${current} -> ${candidate} ` +
    `(delta=${deltaNum}, sign=${signNum})`
  );
  for (const warning of warnings) ctx.log(`[calibration-offset][warn] ${warning}`);
  return { state: { calibrationOffset: result }, ...result };
}

module.exports = { id, title, description, inputs, run, parseOffset, LAYER_PATH };
