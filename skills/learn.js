'use strict';
/**
 * learn —— 把实际修复结果写回本地知识库。
 *
 * 写入内容（只有 confirm=true 的真实执行才会写）：
 *   1) kb/events.jsonl 追加一条审计记录（计划来源、剧本、尝试、复检、是否有效）；
 *   2) 命中知识库的案例累计 attempts/successes/failures，失败 ≥2 次标记 degraded；
 *   3) 知识库未命中或命中失败后自行尝试成功 → 生成 learned 案例（含成功剧本与签名）。
 *
 * 复检结果优先于动作自报：动作说成功但整体复检仍失败，记为无效经验。
 */

const kb = require('./kb.js');

const id = 'learn';
const title = '修复经验写入知识库';
const description = '把实际执行的修复结果写入 kb/events.jsonl 并更新/新增案例';
const inputs = {
  outcomes: 'repair-parallel 的 outcomes',
  recurrences: 'repair-plan 发现的「冷却期内复发」列表',
  verify: 'verify 输出的复检结果',
  probe: '修复前 env-probe（用于记录证据）',
  confirm: 'boolean，必须为 true 才写',
  kbDir: '知识库目录'
};

async function run(ctx, {
  outcomes = [],
  recurrences = [],
  verify = null,
  probe = null,
  confirm = false,
  kbDir
} = {}) {
  const dir = kb.resolveDir(kbDir || (ctx && ctx.kbDir) || kb.DEFAULT_DIR);
  const executed = (outcomes || []).filter(
    (outcome) => outcome && (outcome.status === 'success' || outcome.status === 'failed')
  );

  if (!confirm) {
    ctx.log('[learn] skip：dry-run 不写知识库');
    const kbWrite = {
      skipped: true,
      reason: 'dry-run 不写知识库',
      dir,
      eventsWritten: 0,
      casesWritten: [],
      casesUpdated: []
    };
    return { state: { kbWrite }, kbWrite };
  }

  const recurrenceItems = (recurrences || []).filter((item) => item && item.caseId);
  if (!executed.length && !recurrenceItems.length) {
    ctx.log('[learn] skip：没有实际执行的修复，也没有需要记录的复发');
    const kbWrite = {
      skipped: true,
      reason: '没有实际执行的修复或复发',
      dir,
      eventsWritten: 0,
      casesWritten: [],
      casesUpdated: []
    };
    return { state: { kbWrite }, kbWrite };
  }

  let write = {
    dir,
    eventsFile: kb.resolveDir(dir) + '/events.jsonl',
    eventsWritten: 0,
    casesWritten: [],
    casesUpdated: [],
    skippedOutcomes: []
  };
  if (executed.length) {
    write = await kb.applyOutcomes(dir, { outcomes: executed, verify, probe });
  }
  for (const recurrence of recurrenceItems) {
    const recorded = kb.recordRecurrence(dir, { ...recurrence, probe });
    if (recorded.recorded) write.eventsWritten += 1;
    if (recorded.caseUpdated && !write.casesUpdated.includes(recurrence.caseId)) {
      write.casesUpdated.push(recurrence.caseId);
    }
  }

  ctx.log(
    `[learn] dir=${dir} events=${write.eventsWritten} ` +
    `new_cases=${write.casesWritten.length} updated_cases=${write.casesUpdated.length} ` +
    `recurrences=${recurrenceItems.length}`
  );

  return {
    state: { kbWrite: write },
    kbWrite: write
  };
}

module.exports = { id, title, description, inputs, run };
