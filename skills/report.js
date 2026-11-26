'use strict';
/**
 * report —— 把探测、检查、诊断、修复和复检汇总成一份 Markdown 报告。
 */

const fsDefault = require('fs');
const path = require('path');

const id = 'report';
const title = '自检报告生成';
const description = '输出 Markdown，并写入 reports/ 目录（如果 ctx.fs 可用）';
const inputs = {
  probe: 'env-probe 输出',
  checks: 'selfcheck 输出',
  summary: 'selfcheck 汇总',
  diagnosis: 'diagnose 输出（可选）',
  repair: 'repair 输出（可选）',
  verify: 'verify 输出（可选）',
  safety: 'safety 审查输出（可选）',
  auto: '自动修复流程输出（可选）：plans / kbLookups / repairParallel / kbWrite',
  baseline: '官方基线（可选）：默认读取 knowledge/official-baseline.json'
};

const OFFICIAL_BASELINE_PATH = path.join(__dirname, '..', 'knowledge', 'official-baseline.json');
const NON_OK = new Set(['warn', 'fail', 'unknown']);

function loadOfficialBaseline(fs, override) {
  if (override && typeof override === 'object') return override;
  const reader = fs || fsDefault;
  try {
    return JSON.parse(reader.readFileSync(OFFICIAL_BASELINE_PATH, 'utf8'));
  } catch (_) {
    return null; // 知识库尚未建立时报告仍然可用
  }
}

/** 把一条检查项映射到官方基线条目；没有映射时返回 null。 */
function baselineEntryFor(checkId, baseline) {
  if (!baseline || !baseline.checkToBaseline) return null;
  return baseline.checkToBaseline[checkId] || null;
}

function esc(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function statusLabel(status) {
  return { ok: 'OK', warn: 'WARN', fail: 'FAIL', unknown: 'UNKNOWN' }[status] || String(status).toUpperCase();
}

/**
 * 官方对照段落：把本次非 ok 的检查项映射到官方手册出处 + 官方建议（人工执行）。
 * baseline 可来自 official-baseline skill（{path, source, spec, ...}）或直接传 JSON spec；
 * 没有时 report 自己读 knowledge/official-baseline.json。
 */
function renderOfficialComparison(lines, checks, probe, baseline) {
  const spec = baseline && (baseline.spec || baseline.checkToBaseline) ? (baseline.spec || baseline) : loadOfficialBaseline(fsDefault);
  const counts = { warn: 0, fail: 0, unknown: 0 };
  const nonOk = (checks || []).filter((c) => NON_OK.has(c.status));
  for (const c of nonOk) counts[c.status] += 1;

  lines.push('## 官方对照（来自 knowledge/）');
  lines.push('');
  lines.push(
    `- 基线来源：\`${(baseline && baseline.path) || OFFICIAL_BASELINE_PATH}\`` +
    (baseline && baseline.source === 'fallback' ? '（官方基线文件不可读，使用内置兜底）' : '')
  );
  if (spec && spec.executionBoundary) lines.push(`- 执行边界：${esc(spec.executionBoundary)}`);

  const cutover = (spec && spec.modelDetection && spec.modelDetection.codeCutoverDate) || '2023-11-29';
  const lockSeconds =
    (spec && spec.bootBehavior && (spec.bootBehavior.lockAfterSeconds || spec.bootBehavior.servoLockAfterPowerOnSeconds)) || 40;
  const bootCitation = (spec && spec.bootBehavior && spec.bootBehavior.citation) || '《ROBAN机器人使用入门》 p.11–12';
  const modelCitation = (spec && spec.modelDetection && spec.modelDetection.citation) || '《Roban机器人版本查询手册》 p.2';

  lines.push(
    `- 本次机型：${esc(probe.robotModel || 'UNKNOWN')}（${esc(probe.osRelease || '系统版本未知')}, ` +
    `ROS ${esc(probe.rosDistro || '未知')}) —— 出处 ${modelCitation}`
  );
  lines.push(
    `- 本次代码时间：${esc((probe.repo && probe.repo.commitDate) || '无法读取')}` +
    `（官方阈值 ${cutover}，早于该日期需人工执行更新脚本 —— 《Roban机器人版本查询手册》 p.1）`
  );
  lines.push(
    `- 本次开机时长：${probe.uptimeSeconds === null || probe.uptimeSeconds === undefined ? '未知' : probe.uptimeSeconds + ' s'}` +
    `（官方：上电约 ${lockSeconds} s 后全舵机加锁并恢复初始站立姿态 —— ${bootCitation}）`
  );
  lines.push('');

  if (!nonOk.length) {
    lines.push('- 本次没有非 ok 检查项，无需对照官方手册。');
    lines.push('');
    return;
  }

  lines.push(
    `### 非 ok 检查项 → 官方出处 → 官方建议（人工执行，agent 不自动执行）：` +
    `warn ${counts.warn} / fail ${counts.fail} / unknown ${counts.unknown}`
  );
  lines.push('');
  lines.push('| 检查项 | 状态 | 官方出处 | 官方建议（人工） |');
  lines.push('|---|---|---|---|');
  for (const c of nonOk) {
    const entry = baselineEntryFor(c.id, spec);
    const citation = entry ? entry.citation : '（知识库无对应条目：内部规则）';
    const advice = entry ? entry.manualAdvice : '无官方步骤，按内部规则人工排查';
    lines.push(`| ${esc(c.id)} | ${statusLabel(c.status)} | ${esc(citation)} | ${esc(advice)} |`);
  }
  lines.push('');

  if (baseline && baseline.officialSelfCheck && baseline.officialSelfCheck.length) {
    lines.push('### 官方自检程序（《Roban机器人自检手册》p.1–2）');
    lines.push('');
    for (const step of baseline.officialSelfCheck) {
      lines.push(
        `- ${esc(step.step)}：${esc(step.detail)} [出处 ${esc(step.citation || '')}]` +
        `${step.agentRunsIt ? '（agent 只读执行）' : '（需人工在机器人终端执行）'}`
      );
    }
    lines.push('');
  }

  if (baseline && baseline.safetyNotes && baseline.safetyNotes.length) {
    lines.push('### 官方安全提示');
    lines.push('');
    for (const note of baseline.safetyNotes) {
      lines.push(`- ${esc(note.note)} [出处 ${esc(note.citation || '')}] → ${esc(note.action || '')}`);
    }
    lines.push('');
  }
}

function renderSafety(lines, safety) {
  if (!safety) return;
  lines.push('## 安全审查');
  lines.push('');
  if (safety.rules) {
    lines.push(`- 规则文件：${esc(safety.rules.path)}`);
    lines.push(`- SHA-256：${esc(safety.rules.sha256 || '')}`);
    lines.push(`- 读取时间：${esc(safety.rules.loadedAt || '')}`);
  }
  lines.push(`- 结论：${safety.approved ? '通过' : '未通过'}${safety.execute === false ? '（dry-run 计划）' : ''}`);
  if (safety.actions && safety.actions.length) {
    lines.push('- 动作分类：');
    for (const item of safety.actions) {
      const kind = item.forbidden ? '禁止' : item.motion ? '运动（需批准）' : item.allowed ? '允许' : '未授权';
      lines.push(`  - ${esc(item.action)}：${kind}${item.reason ? `（${esc(item.reason)}）` : ''}`);
    }
  }
  if (safety.violations && safety.violations.length) {
    lines.push('- 违规：');
    for (const violation of safety.violations) {
      lines.push(`  - ${esc(violation.action)}：${esc(violation.reason)}`);
    }
  }
  if (safety.warnings && safety.warnings.length) {
    lines.push('- 计划期警告：');
    for (const warning of safety.warnings) {
      lines.push(`  - ${esc(warning.action)}：${esc(warning.reason)}`);
    }
  }
  if (safety.stopInstructions) {
    lines.push('- 运动停止说明：');
    lines.push('```text');
    lines.push(safety.stopInstructions);
    lines.push('```');
  }
  lines.push('');
}

function renderAuto(lines, auto) {
  if (!auto) return;

  lines.push('## 自动修复（知识库优先 + 并行）');
  lines.push('');
  const lookups = auto.kbLookups || [];
  if (lookups.length) {
    lines.push('### 故障单元与知识库检索');
    lines.push('');
    lines.push('| 组件 | 严重度 | 检查项 | 知识库 | 匹配案例 | 计划来源 | 计划状态 |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const item of lookups) {
      const kbHit = item.matched
        ? `${item.score.toFixed(2)}${item.degraded ? '（degraded）' : ''}`
        : '未命中';
      lines.push(
        `| ${esc(item.unitId)} | ${statusLabel(item.severity)} | ${esc((item.checks || []).join(', '))} | ` +
        `${esc(kbHit)} | ${esc(item.matchedCaseId || '—')} | ${esc(item.source)} | ${esc(item.status)} |`
      );
    }
    lines.push('');
  }

  const recurrences = auto.recurrences || [];
  if (recurrences.length) {
    lines.push('### 冷却期内复发（停止自动重启）');
    lines.push('');
    for (const recurrence of recurrences) {
      const minutes = recurrence.elapsedMs
        ? `${Math.round((recurrence.elapsedMs / 60000) * 10) / 10} 分钟`
        : '未知时长';
      lines.push(
        `- ${esc(recurrence.unitId || recurrence.component)}：案例 ${esc(recurrence.caseId || '')} ` +
        `上次成功后 ${minutes} 内复发，已阻止自动重启；请检查 USB/供电/线缆。`
      );
    }
    lines.push('');
  }

  const parallel = auto.repairParallel;
  if (parallel) {
    const summary = parallel.summary || {};
    lines.push(
      `- 执行模式：${parallel.mode}；并发上限 ${parallel.concurrency}；实际最大并发 ${parallel.maxConcurrency}；` +
      `耗时 ${parallel.durationMs} ms`
    );
    lines.push(
      `- 结果：成功 ${summary.success || 0} / 失败 ${summary.failed || 0} / ` +
      `阻止 ${summary.blocked || 0} / 人工 ${summary.manual_required || 0} / dry-run ${summary.dry_run || 0}`
    );
    lines.push('');
    if ((parallel.outcomes || []).length) {
      lines.push('| 组件 | 状态 | 执行来源 | 知识库案例 | 动作（尝试） | 耗时 ms |');
      lines.push('|---|---|---|---|---|---|');
      for (const outcome of parallel.outcomes) {
        const actions = (outcome.attempts || [])
          .map((attempt) => `${attempt.action}${attempt.status ? `=${attempt.status}` : ''}`)
          .join(' → ') || '—';
        lines.push(
          `| ${esc(outcome.component || outcome.unitId)} | ${esc(outcome.status)} | ` +
          `${esc(outcome.executedSource || outcome.planSource || '—')} | ${esc(outcome.caseId || '—')} | ` +
          `${esc(actions)} | ${outcome.durationMs || 0} |`
        );
      }
      lines.push('');
    }
    for (const outcome of parallel.outcomes || []) {
      if (!outcome.failureNote) continue;
      lines.push(`- ${esc(outcome.unitId)}：${esc(outcome.failureNote)}`);
    }
    lines.push('');
  }

  const kbWrite = auto.kbWrite;
  if (kbWrite) {
    lines.push('### 知识库更新');
    lines.push('');
    lines.push(`- 目录：${esc(kbWrite.dir)}`);
    if (kbWrite.skipped === true) {
      lines.push(`- 本次未写入：${esc(kbWrite.reason || '')}`);
    } else {
      lines.push(`- 事件日志：${esc(kbWrite.eventsFile)}（新增 ${kbWrite.eventsWritten} 条）`);
      lines.push(`- 新增案例：${(kbWrite.casesWritten || []).join(', ') || '无'}`);
      lines.push(`- 更新案例：${(kbWrite.casesUpdated || []).join(', ') || '无'}`);
    }
    lines.push('');
  }
}

function buildMarkdown({ probe, checks, summary, diagnosis, repair, verify, safety, auto, baseline }) {
  const lines = [];
  lines.push('# Roban 自检报告');
  lines.push('');
  lines.push(`- 机器人：${probe.host || 'unknown'} (${probe.ip || ''})`);
  lines.push(`- 采集时间：${probe.time || ''}`);
  lines.push(`- BodyHub：${probe.bodyhubState}，masterID=${probe.masterId}`);
  lines.push(`- 总览：OK ${summary.ok} / WARN ${summary.warn} / FAIL ${summary.fail} / UNKNOWN ${summary.unknown}`);
  lines.push('');

  lines.push('## 检查项');
  lines.push('');
  lines.push('| 状态 | 检查 | 说明 |');
  lines.push('|---|---|---|');
  for (const c of checks) {
    lines.push(`| ${statusLabel(c.status)} | ${esc(c.id)} | ${esc(c.detail)} |`);
  }
  lines.push('');

  // 新增段落：紧跟「检查项」之后
  renderOfficialComparison(lines, checks, probe, baseline);

  renderSafety(lines, safety);
  renderAuto(lines, auto);

  if (diagnosis) {
    lines.push('## 诊断');
    lines.push('');
    if (diagnosis.findings && diagnosis.findings.length) {
      lines.push('### 发现');
      lines.push('');
      for (const f of diagnosis.findings) {
        lines.push(`- [${statusLabel(f.severity)}] ${esc(f.statement)}（${f.category}，置信度 ${f.confidence}）`);
      }
      lines.push('');
    }
    if (diagnosis.hypotheses && diagnosis.hypotheses.length) {
      lines.push('### 候选原因');
      lines.push('');
      for (const h of diagnosis.hypotheses) {
        lines.push(`- **${h.id}**：${esc(h.statement)}（置信度 ${h.confidence}）`);
        if (h.evidence && h.evidence.length) lines.push(`  - 证据：${h.evidence.map(esc).join('；')}`);
      }
      lines.push('');
    }
    if (diagnosis.repairCandidates && diagnosis.repairCandidates.length) {
      lines.push('### 修复候选');
      lines.push('');
      for (const r of diagnosis.repairCandidates) {
        lines.push(`- **${r.action}**（${r.level}）：${esc(r.title)}；需确认=${r.requires_confirm}`);
        lines.push(`  - 前置条件：${esc(JSON.stringify(r.preconditions))}`);
        lines.push(`  - 复检：${esc(JSON.stringify(r.verification))}`);
      }
      lines.push('');
    }
  }

  if (repair) {
    lines.push('## 修复记录');
    lines.push('');
    lines.push(`- 动作：${repair.action}`);
    lines.push(`- 状态：${repair.status}${repair.dry_run ? '（dry-run，未执行）' : ''}`);
    if (repair.before) lines.push(`- 修复前：${esc(JSON.stringify(repair.before))}`);
    if (repair.after) lines.push(`- 修复后：${esc(JSON.stringify(repair.after))}`);
    if (repair.log_tail) {
      lines.push('');
      lines.push('```text');
      lines.push(repair.log_tail);
      lines.push('```');
    }
    lines.push('');
  }

  if (verify) {
    lines.push('## 复检');
    lines.push('');
    lines.push(`- 修复目标通过：${verify.verified}`);
    lines.push(`- 复检前：OK ${verify.before_summary.ok} / WARN ${verify.before_summary.warn} / FAIL ${verify.before_summary.fail} / UNKNOWN ${verify.before_summary.unknown}`);
    lines.push(`- 复检后：OK ${verify.after_summary.ok} / WARN ${verify.after_summary.warn} / FAIL ${verify.after_summary.fail} / UNKNOWN ${verify.after_summary.unknown}`);
    if (verify.changes && verify.changes.length) {
      lines.push('- 状态变化：');
      for (const c of verify.changes) {
        lines.push(`  - ${c.id}: ${statusLabel(c.before)} -> ${statusLabel(c.after)}（${esc(c.detail)}）`);
      }
    }
    lines.push('');
  }

  if (diagnosis && diagnosis.needsUserInput && diagnosis.needsUserInput.length) {
    lines.push('## 人工待办');
    lines.push('');
    for (const item of diagnosis.needsUserInput) lines.push(`- ${esc(item)}`);
    lines.push('');
  }

  lines.push('## 数据来源说明');
  lines.push('');
  lines.push('- `GetJointAngle` 返回软件缓存角，不是电机实测位置。');
  lines.push('- 温度 0 表示无读数，不是 0°C；电池用电压判断，不用 percentage。');
  lines.push('- BodyHub 的 Status / ServoPositions / joint 话题是事件式发布，短窗口无消息不等于故障。');
  lines.push('');

  return lines.join('\n');
}

async function run(ctx, input = {}) {
  const { probe, checks, summary, diagnosis, repair, verify, safety, auto, baseline } = input;
  if (!probe || !checks || !summary) {
    throw new Error('report 需要 probe、checks、summary');
  }

  const markdown = buildMarkdown({
    probe, checks, summary, diagnosis, repair, verify, safety, auto,
    baseline: baseline || loadOfficialBaseline(ctx.fs || fsDefault)
  });
  const fs = ctx.fs || fsDefault;
  const dir = ctx.reportDir || path.join(process.cwd(), 'reports');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filePath = path.join(dir, `roban-selfcheck-${stamp}.md`);

  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, markdown, 'utf8');
  } catch (_) {
    // 报告文件写不进去时仍然返回 markdown，由调用方打印。
  }

  ctx.log(`[report] ${filePath}`);
  return {
    state: { report: { path: filePath, markdown } },
    path: filePath,
    markdown
  };
}

module.exports = { id, title, description, inputs, run, buildMarkdown };
