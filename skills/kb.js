'use strict';
/**
 * kb —— 本地经验知识库的读写层。
 *
 * 职责：
 *   1) 加载 / 校验 kb/cases/*.json（剧本动作必须在 repair 白名单内）；
 *   2) 对故障单元做「组件 + 谓词 + 检查项 + 关键词」匹配，返回最优经验；
 *   3) 生成修复计划：命中经验优先；未命中或经验 degraded 时回退到组件的安全动作阶梯；
 *   4) 把实际执行结果写回：events.jsonl 审计日志 + 案例统计 / 自动习得的新案例。
 *
 * 写操作全部串行化（进程内文件锁 + tmp+rename 原子写），避免并行修复时互相覆盖。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const repair = require('./repair.js');
const safety = require('./safety.js');

const DEFAULT_DIR = path.join(__dirname, '..', 'kb');
const CASE_SUBDIR = 'cases';
const EVENTS_FILE = 'events.jsonl';
const ACTION_IDS = Object.keys(repair.ACTIONS);
const SCHEMA_VERSION = 1;

/* ------------------------------------------------------------------ *
 * 工具
 * ------------------------------------------------------------------ */

const LOCKS = new Map();

function withFileLock(key, fn) {
  const prev = LOCKS.get(key) || Promise.resolve();
  const run = prev.then(fn, fn);
  LOCKS.set(key, run.catch(() => {}));
  return run;
}

function resolveDir(input) {
  const dir = input || DEFAULT_DIR;
  return path.isAbsolute(dir) ? dir : path.resolve(dir);
}

function ensureLayout(dir) {
  fs.mkdirSync(path.join(dir, CASE_SUBDIR), { recursive: true });
}

function slug(value) {
  const s = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'case';
}

function shortHash(value) {
  return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 8);
}

function nowIso() {
  return new Date().toISOString();
}

function readPath(obj, dotted) {
  if (obj == null || !dotted) return undefined;
  return String(dotted)
    .split('.')
    .reduce((node, key) => (node == null ? undefined : node[key]), obj);
}

/* ------------------------------------------------------------------ *
 * 加载与校验
 * ------------------------------------------------------------------ */

function listCaseFiles(dir) {
  const caseDir = path.join(dir, CASE_SUBDIR);
  try {
    return fs
      .readdirSync(caseDir)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => path.join(caseDir, name));
  } catch (_) {
    return [];
  }
}

function loadCases(dir) {
  const cases = [];
  const warnings = [];
  for (const file of listCaseFiles(resolveDir(dir))) {
    try {
      let item = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (safety.hasIp(item)) {
        warnings.push(`${path.basename(file)}: 包含 IP/主机地址，已按 ATTENTION 规则脱敏并忽略`);
        item = safety.redactIps(item);
      }
      item.__file = file;
      cases.push(item);
    } catch (err) {
      warnings.push(`${path.basename(file)}: ${err.message}`);
    }
  }
  return { cases, warnings };
}

function loadCaseById(dir, id) {
  return loadCases(dir).cases.find((item) => item.id === id) || null;
}

function validatePlaybook(playbook) {
  const errors = [];
  if (!Array.isArray(playbook) || playbook.length === 0) {
    errors.push('playbook 为空');
    return { ok: false, errors };
  }
  for (const step of playbook) {
    if (!step || typeof step !== 'object' || !step.action) {
      errors.push('步骤缺少 action');
    } else if (!ACTION_IDS.includes(step.action)) {
      errors.push(`未授权动作：${step.action}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function validateCase(item) {
  const errors = [];
  if (!item || typeof item !== 'object') return { ok: false, errors: ['案例不是对象'] };
  if (safety.hasIp(item)) errors.push('案例包含机器人 IP/主机地址，必须删除后重试');
  if (!item.id) errors.push('缺少 id');
  if (!item.component) errors.push('缺少 component');
  if (!Array.isArray(item.checkIds) || item.checkIds.length === 0) errors.push('checkIds 为空');
  if (item.schemaVersion != null && item.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`schemaVersion 不支持：${item.schemaVersion}`);
  }
  if (item.autoRepairable === true) {
    const playbook = validatePlaybook(item.playbook);
    if (!playbook.ok) errors.push(...playbook.errors);
  }
  if (item.signature && item.signature.predicates && !Array.isArray(item.signature.predicates)) {
    errors.push('signature.predicates 必须是数组');
  }
  return { ok: errors.length === 0, errors };
}

/* ------------------------------------------------------------------ *
 * 匹配
 * ------------------------------------------------------------------ */

function matchPredicates(predicates, probe) {
  const reasons = [];
  for (const predicate of predicates || []) {
    if (/(^|\.)(ip|host|hostname|address|remoteHost|sshHost)$/i.test(String(predicate.path || ''))) {
      return {
        passed: false,
        reasons: ['知识库不得使用 IP/主机地址作为匹配条件（ATTENTION 规则 1）']
      };
    }
    const actual = readPath(probe, predicate.path);
    const expected = predicate.value;
    if (safety.hasIp(expected)) {
      return {
        passed: false,
        reasons: ['知识库谓词值包含 IP（ATTENTION 规则 1）']
      };
    }
    let ok = false;
    switch (predicate.op) {
      case 'eq':
        ok = String(actual) === String(expected);
        break;
      case 'ieq':
        ok = String(actual).toLowerCase() === String(expected).toLowerCase();
        break;
      case 'ne':
        ok = String(actual) !== String(expected);
        break;
      case 'in':
        ok = Array.isArray(expected) && expected.some((v) => String(v) === String(actual));
        break;
      case 'contains':
        ok = String(actual == null ? '' : actual).includes(String(expected));
        break;
      case 'truthy':
        ok = Boolean(actual);
        break;
      case 'gte':
        ok = Number(actual) >= Number(expected);
        break;
      case 'lte':
        ok = Number(actual) <= Number(expected);
        break;
      default:
        ok = false;
        reasons.push(`未知谓词操作符：${predicate.op}`);
    }
    reasons.push(
      `${predicate.path} ${predicate.op} ${JSON.stringify(expected)}` +
        ` -> ${JSON.stringify(actual)} (${ok ? 'ok' : 'no'})`
    );
    if (!ok) return { passed: false, reasons };
  }
  return { passed: true, reasons };
}

function scoring(unit, item, probe) {
  if (item.component !== unit.component) {
    return { applicable: false, score: 0, reasons: [`component 不一致：${item.component}`] };
  }
  const predicates = item.signature && item.signature.predicates;
  const predicateResult = matchPredicates(predicates, probe);
  if (!predicateResult.passed) {
    return { applicable: false, score: 0, reasons: predicateResult.reasons };
  }

  const caseChecks = item.checkIds || [];
  const overlap = caseChecks.filter((checkId) => (unit.checks || []).includes(checkId)).length;
  const checkScore = caseChecks.length ? overlap / caseChecks.length : 0;

  const keywords = (item.signature && item.signature.keywords) || [];
  const text = (unit.findings || []).map((finding) => finding.statement || '').join(' ');
  const hits = keywords.filter((keyword) => text.includes(keyword)).length;
  const keywordScore = keywords.length ? hits / keywords.length : 0;

  const score = 0.5 + 0.3 * checkScore + 0.2 * keywordScore;
  return {
    applicable: true,
    score: Number(score.toFixed(3)),
    reasons: [
      ...predicateResult.reasons,
      `check_overlap=${overlap}/${caseChecks.length}`,
      `keyword_hits=${hits}/${keywords.length}`
    ]
  };
}

function isDegraded(item) {
  const stats = item.stats || {};
  return (
    item.degraded === true ||
    ((stats.failures || 0) >= 2 && (stats.successes || 0) === 0)
  );
}

/**
 * 冷却期检查：同一经验刚成功修复过，若冷却期内同故障再次出现，
 * 说明修复只是临时缓解（例如 USB 重新枚举），不应继续自动重启。
 */
function cooldownState(item) {
  const cooldownMs = Number(item.cooldownMs || 0);
  if (!cooldownMs) return null;
  const stats = item.stats || {};
  if (stats.lastOutcome !== 'success' || !stats.lastAttemptAt) return null;
  const last = Date.parse(stats.lastAttemptAt);
  if (!Number.isFinite(last)) return null;
  const elapsedMs = Date.now() - last;
  if (elapsedMs < 0 || elapsedMs >= cooldownMs) return null;
  return {
    detected: true,
    caseId: item.id,
    cooldownMs,
    elapsedMs,
    previousSuccessAt: stats.lastAttemptAt
  };
}

/**
 * 返回 {caseDef, score, reasons, degraded} 或 null。
 * 只在 component + 谓词都通过时返回候选；分数用于排序。
 */
function findBest(dir, unit, probe) {
  let best = null;
  for (const item of loadCases(dir).cases) {
    const result = scoring(unit, item, probe);
    if (!result.applicable) continue;
    if (!best || result.score > best.score) {
      best = { caseDef: item, score: result.score, reasons: result.reasons };
    }
  }
  if (!best) return null;
  return { ...best, degraded: isDegraded(best.caseDef) };
}

/* ------------------------------------------------------------------ *
 * 前置条件
 * ------------------------------------------------------------------ */

function evaluatePreconditions(preconditions, probe) {
  const reasons = [];
  if (!preconditions) return { ok: true, reasons };
  if (preconditions.bodyhubState) {
    const allowed = preconditions.bodyhubState;
    if (!allowed.includes(probe.bodyhubState)) {
      reasons.push(`BodyHub 状态 ${probe.bodyhubState} 不在允许集合 ${allowed.join('/')}`);
    }
  }
  if (preconditions.masterId !== undefined && probe.masterId !== preconditions.masterId) {
    reasons.push(`masterID=${probe.masterId}，要求 ${preconditions.masterId}`);
  }
  if (preconditions.usbCam && probe.usbCam !== preconditions.usbCam) {
    reasons.push(`/dev/usb_cam=${probe.usbCam}，要求 ${preconditions.usbCam}`);
  }
  return { ok: reasons.length === 0, reasons };
}

/* ------------------------------------------------------------------ *
 * 计划
 * ------------------------------------------------------------------ */

/**
 * 为一个故障单元生成修复计划。
 *
 * status:
 *   ready   —— 可以执行（source=kb 或 generated）
 *   blocked —— 安全前置条件不满足，禁止执行
 *   manual  —— 无自动修复路径，只给人工建议
 */
function planForUnit(dir, unit, probe) {
  const best = findBest(dir, unit, probe);
  const match = best
    ? {
        caseId: best.caseDef.id,
        caseTitle: best.caseDef.title,
        score: best.score,
        source: best.caseDef.source || 'unknown',
        reasons: best.reasons,
        degraded: best.degraded,
        autoRepairable: best.caseDef.autoRepairable === true
      }
    : null;
  const pre = evaluatePreconditions(unit.preconditions, probe);
  const base = {
    unitId: unit.id,
    title: unit.title,
    severity: unit.severity,
    component: unit.component,
    targets: unit.targets,
    locks: unit.locks,
    autoRepairable: unit.autoRepairable === true,
    match,
    unit
  };

  if (!unit.autoRepairable) {
    const advice =
      (match && best.caseDef.manualAdvice) || unit.manualReason || '无自动修复路径，需人工处理。';
    return {
      ...base,
      status: 'manual',
      source: match ? 'kb-manual' : 'none',
      reason: advice,
      advice,
      playbook: []
    };
  }

  // 1) 知识库命中且可用
  if (match && match.autoRepairable && !match.degraded) {
    const validation = validatePlaybook(best.caseDef.playbook);
    if (validation.ok) {
      const cooldown = cooldownState(best.caseDef);
      if (cooldown) {
        const minutes = Math.round((cooldown.elapsedMs / 60000) * 10) / 10;
        return {
          ...base,
          status: 'blocked',
          source: 'kb',
          caseId: best.caseDef.id,
          caseTitle: best.caseDef.title,
          score: best.score,
          playbook: [],
          recurrence: cooldown,
          reason:
            `上次修复成功（${cooldown.previousSuccessAt}）后 ${minutes} 分钟内同故障复发；` +
            '冷却期内停止自动重启，疑似 USB/供电链路不稳定，转人工检查线缆与接口。'
        };
      }
      if (pre.ok) {
        return {
          ...base,
          status: 'ready',
          source: 'kb',
          caseId: best.caseDef.id,
          caseTitle: best.caseDef.title,
          score: best.score,
          playbook: best.caseDef.playbook,
          reason: `命中知识库：${best.caseDef.title}`
        };
      }
      return {
        ...base,
        status: 'blocked',
        source: 'kb',
        caseId: best.caseDef.id,
        caseTitle: best.caseDef.title,
        score: best.score,
        playbook: [],
        reason: `知识库经验命中，但安全前置条件不满足：${pre.reasons.join('；')}`
      };
    }
  }

  // 2) 未命中 / 经验不可用 / degraded → 自行尝试
  if (!pre.ok) {
    return {
      ...base,
      status: 'blocked',
      source: 'generated',
      playbook: [],
      reason: `自行尝试也被安全前置条件阻止：${pre.reasons.join('；')}`
    };
  }
  return {
    ...base,
    status: 'ready',
    source: 'generated',
    caseId: null,
    playbook: unit.generatedPlaybook || [],
    reason: match
      ? '知识库经验不可用（degraded 或剧本无效），改用自行尝试'
      : '知识库未命中，使用自行尝试'
  };
}

/* ------------------------------------------------------------------ *
 * 写入
 * ------------------------------------------------------------------ */

function probeSnapshot(probe) {
  if (!probe) return null;
  return {
    usbCam: probe.usbCam,
    usbServo: probe.usbServo,
    chinCameraNode: probe.chinCameraNode,
    realsenseNode: probe.realsenseNode,
    bodyhubState: probe.bodyhubState,
    masterId: probe.masterId,
    rates: probe.rates,
    tempZeroIds: probe.tempZeroIds,
    dxlBulkReadErrors: probe.logs ? probe.logs.dxlBulkReadErrors : null,
    deadProcessNames: probe.logs ? probe.logs.deadProcessNames : null,
    batteryVoltage: probe.battery ? probe.battery.voltage : null
  };
}

function recordEvent(dir, event) {
  ensureLayout(dir);
  const clean = safety.redactIps(event);
  fs.appendFileSync(path.join(dir, EVENTS_FILE), `${JSON.stringify(clean)}\n`, 'utf8');
}

function writeCaseFile(dir, item) {
  ensureLayout(dir);
  const clean = safety.redactIps({ ...item });
  const target = clean.__file || path.join(dir, CASE_SUBDIR, `${slug(clean.id)}.json`);
  delete clean.__file;
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(clean, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, target);
}

function learnedCaseId(outcome) {
  const checks = (outcome.unitChecks || []).slice().sort().join('|');
  return `learned-${slug(outcome.component)}-${shortHash(checks)}`;
}

function targetResultsFor(outcome, verify) {
  const after = new Map(
    ((verify && Array.isArray(verify.targets) ? verify.targets : []) || []).map((target) => [
      target.id,
      target.status
    ])
  );
  const ids = outcome.targets || [];
  return ids
    .filter((id) => after.has(id))
    .map((id) => ({ id, status: after.get(id) }));
}

function isEffective(outcome, targetResults) {
  if (outcome.status !== 'success') return false;
  if (!targetResults.length) return true; // 没有复检目标时按动作自报结果
  return targetResults.every((target) => target.status === 'ok');
}

/**
 * 把实际执行结果写入知识库（事件 + 案例统计 + 自动习得）。
 *
 * @returns {{dir, eventsFile, eventsWritten, casesWritten, casesUpdated, skippedOutcomes}}
 */
async function applyOutcomes(dirInput, { outcomes = [], verify = null, probe = null, timestamp } = {}) {
  const dir = resolveDir(dirInput);
  const ts = timestamp || nowIso();
  const result = {
    dir,
    eventsFile: path.join(dir, EVENTS_FILE),
    eventsWritten: 0,
    casesWritten: [],
    casesUpdated: [],
    skippedOutcomes: []
  };
  ensureLayout(dir);

  for (const outcome of outcomes) {
    if (!outcome || (outcome.status !== 'success' && outcome.status !== 'failed')) {
      result.skippedOutcomes.push(outcome && outcome.unitId ? outcome.unitId : 'unknown');
      continue;
    }

    const targetResults = targetResultsFor(outcome, verify);
    const effective = isEffective(outcome, targetResults);
    const event = {
      ts,
      kind: 'repair-attempt',
      unitId: outcome.unitId,
      component: outcome.component,
      planSource: outcome.planSource,
      executedSource: outcome.executedSource,
      caseId: outcome.caseId || null,
      kbPlaybookStatus: outcome.kbPlaybookStatus || null,
      status: outcome.status,
      effective,
      targetResults,
      playbook: outcome.usedPlaybook || [],
      attempts: (outcome.attempts || []).map((attempt) => ({
        action: attempt.action,
        attempt: attempt.attempt,
        status: attempt.status
      })),
      durationMs: outcome.durationMs,
      evidence: probeSnapshot(probe),
      note: outcome.failureNote || undefined
    };
    recordEvent(dir, event);
    result.eventsWritten += 1;

    // 命中知识库的经验 → 更新统计
    if (outcome.caseId) {
      const existing = loadCaseById(dir, outcome.caseId);
      if (existing) {
        const updated = { ...existing };
        updated.stats = {
          attempts: 0,
          successes: 0,
          failures: 0,
          lastOutcome: null,
          lastAttemptAt: null,
          ...(updated.stats || {})
        };
        updated.stats.attempts += 1;
        const kbSuccess = outcome.kbPlaybookStatus === 'success' && effective;
        if (kbSuccess) updated.stats.successes += 1;
        else updated.stats.failures += 1;
        updated.stats.lastOutcome = kbSuccess ? 'success' : 'failed';
        updated.stats.lastAttemptAt = ts;
        updated.updatedAt = ts;
        updated.lastEvidence = probeSnapshot(probe);
        if (kbSuccess) {
          updated.degraded = false;
          delete updated.lastFailure;
        } else {
          updated.degraded =
            updated.stats.failures >= 2 && updated.stats.successes === 0;
          updated.lastFailure = {
            at: ts,
            status: outcome.status,
            note: outcome.failureNote || ''
          };
        }
        writeCaseFile(dir, updated);
        result.casesUpdated.push(updated.id);
      } else {
        result.skippedOutcomes.push(`missing-case:${outcome.caseId}`);
      }
    }

    // 自行尝试（或知识库失败后的回退）成功 → 自动习得新案例
    const selfAttempted =
      outcome.executedSource === 'generated' || outcome.executedSource === 'kb+fallback';
    if (selfAttempted && effective) {
      const caseId = learnedCaseId(outcome);
      const existing = loadCaseById(dir, caseId);
      let learned;
      if (existing) {
        learned = { ...existing };
        learned.stats = {
          attempts: 0,
          successes: 0,
          failures: 0,
          lastOutcome: null,
          lastAttemptAt: null,
          ...(learned.stats || {})
        };
        learned.updatedAt = ts;
      } else {
        learned = {
          schemaVersion: SCHEMA_VERSION,
          id: caseId,
          title: `自动习得：${outcome.title || outcome.component}`,
          component: outcome.component,
          checkIds: (outcome.unitChecks || []).slice(),
          signature: {
            predicates: (outcome.unitPredicates || []).slice(),
            keywords: (outcome.unitKeywords || []).slice()
          },
          autoRepairable: true,
          preconditions: outcome.unitPreconditions || null,
          verification: outcome.verification || null,
          stats: {
            attempts: 0,
            successes: 0,
            failures: 0,
            lastOutcome: null,
            lastAttemptAt: null
          },
          source: 'learned',
          notes: '由自动修复成功路径写入：知识库未命中或命中经验失败后自行尝试成功。',
          createdAt: ts,
          updatedAt: ts
        };
        result.casesWritten.push(caseId);
      }
      learned.playbook = outcome.usedPlaybook && outcome.usedPlaybook.length
        ? outcome.usedPlaybook
        : learned.playbook;
      learned.stats.attempts += 1;
      learned.stats.successes += 1;
      learned.stats.lastOutcome = 'success';
      learned.stats.lastAttemptAt = ts;
      learned.updatedAt = ts;
      if (outcome.caseId) learned.replaces = outcome.caseId;
      learned.lastEvidence = probeSnapshot(probe);
      writeCaseFile(dir, learned);
      if (!result.casesWritten.includes(caseId)) result.casesUpdated.push(caseId);
    }
  }

  return result;
}

/**
 * 记录「修复成功后短时复发」：追加 recurrence 事件，并更新案例复发统计。
 * 这不是一次修复尝试，因此不增加 attempts/successes/failures。
 */
function recordRecurrence(dirInput, recurrence = {}) {
  const dir = resolveDir(dirInput);
  const ts = recurrence.timestamp || nowIso();
  const result = { dir, eventsFile: path.join(dir, EVENTS_FILE), recorded: false, caseId: recurrence.caseId || null };
  ensureLayout(dir);

  recordEvent(dir, {
    ts,
    kind: 'recurrence',
    unitId: recurrence.unitId || null,
    component: recurrence.component || null,
    caseId: recurrence.caseId || null,
    elapsedMs: recurrence.elapsedMs || null,
    evidence: probeSnapshot(recurrence.probe),
    note: recurrence.note || '修复成功后同故障在冷却期内复发'
  });
  result.recorded = true;

  if (recurrence.caseId) {
    const existing = loadCaseById(dir, recurrence.caseId);
    if (existing) {
      const updated = { ...existing };
      updated.recurrences = (updated.recurrences || 0) + 1;
      updated.lastRecurrence = {
        at: ts,
        elapsedMs: recurrence.elapsedMs || null,
        previousSuccessAt: recurrence.previousSuccessAt || null,
        note: recurrence.note || ''
      };
      updated.updatedAt = ts;
      writeCaseFile(dir, updated);
      result.caseUpdated = true;
    }
  }
  return result;
}

module.exports = {
  DEFAULT_DIR,
  SCHEMA_VERSION,
  ACTION_IDS,
  resolveDir,
  ensureLayout,
  loadCases,
  loadCaseById,
  validateCase,
  validatePlaybook,
  matchPredicates,
  scoring,
  isDegraded,
  cooldownState,
  findBest,
  evaluatePreconditions,
  planForUnit,
  recordEvent,
  recordRecurrence,
  applyOutcomes,
  learnedCaseId,
  probeSnapshot
};
