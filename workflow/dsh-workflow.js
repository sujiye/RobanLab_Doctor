// DSH workflow script body —— Roban 机器人「检测 → 知识库 → 修复 → 报告」编排。
//
// 调用方式（在 dsh 中用自然语言明确要求 workflow）：
//   用户：用 workflow 跑机器人自动修复（dry-run）
//   模型：读取本文件内容，调用 workflow 工具：
//     meta = { name: 'roban-auto-repair', description: '...' }
//     script = 本文件内容
//     args = { host: '<用户提供的 IP>', confirm: false, motionApproved: false, stopPlan: '' }
//
// 说明：workflow 脚本本身不能执行 shell/读文件，所有命令都交给子代理执行。
// 检测/修复的确定性逻辑仍在 Node workflow（workflow/harness-adapter.example.js），
// 本脚本只做多代理编排：安全规则读取、检测代理、并行分析代理、修复代理、报告代理。

const HOST = args && args.host;
const CWD = (args && args.cwd) || '/Users/sujiye/Documents/大三上/智能交互机器人实验/final';
const CONFIRM = Boolean(args && args.confirm === true);
const MOTION_APPROVED = Boolean(args && args.motionApproved === true);
const STOP_PLAN = String((args && args.stopPlan) || '');

if (!HOST) {
  return {
    error: 'missing_host',
    message: '缺少机器人 IP。必须先询问用户当前 IP；不得从知识库、历史会话或报告中读取。'
  };
}

function shQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

const ENV_PREFIX = [
  `ROBAN_MOTION_APPROVED=${MOTION_APPROVED ? '1' : '0'}`,
  STOP_PLAN ? `ROBAN_STOP_PLAN=${shQuote(STOP_PLAN)}` : ''
].filter(Boolean).join(' ') + ' ';

const BASE = `工作目录：${CWD}。机器人：${HOST}。所有命令必须在 ${CWD} 下执行。`;

// 执行前先读 ATTENTION；这一阶段只读文本，不执行机器人命令。
phase('safety');
log('读取 ATTENTION 安全规则');
const safetyReport = await agent(
  [
    '你是 Roban 安全审查代理。第一步必须完整读取并遵守以下文件：',
    `${CWD}/ATTENTION/ATTENTION.md`,
    '不要执行任何机器人命令，只读文件。',
    '返回：',
    '1. 已读取的文件路径与读取时间；',
    '2. 四条规则的要点；',
    '3. 本次流程必须特别检查的事项（IP 来源、运动批准、禁止动作、立即停止方式）。'
  ].join('\n'),
  { label: '读取 ATTENTION', phase: 'safety' }
);

function parseJson(text) {
  if (text && typeof text === 'object') return text;
  const raw = String(text == null ? '' : text).trim();
  if (!raw) return null;
  const lines = raw.split('\n').filter((line) => line.trim());
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line.startsWith('{')) continue;
    try {
      return JSON.parse(line);
    } catch (_) {
      // 继续尝试上一行
    }
  }
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function errorOf(raw) {
  return { error: String(raw == null ? 'unknown' : raw).slice(0, 2000) };
}

phase('detect');
log(`连接 ${HOST} 并做只读检测 + 知识库计划`);

const detectRaw = await agent(
  [
    '你是 Roban 机器人检测代理，只做只读检测，禁止执行修复，禁止加 --confirm。',
    BASE,
    '已由安全代理读取 ATTENTION；你不得修改规则、不得绕过安全审查。',
    'IP 必须来自用户当前消息；如果 HOST 缺失或用户没有确认，停止并询问。',
    '执行：',
    `cd "${CWD}" && ${ENV_PREFIX}ROBAN_HOST=${HOST} node workflow/harness-adapter.example.js auto --json`,
    '',
    '该命令 stdout 只有一行 JSON（包含 summary/checks/units/plans/kbLookups/planSummary/repairParallel(只读预检)/reportPath）。',
    '请原样返回这一行 JSON，不要改写字段、不要补造内容。',
    '如果命令失败，返回 {"error":"<stderr 最后 2000 字符>"}。'
  ].join('\n'),
  { label: '检测 + 知识库计划（只读）', phase: 'detect' }
);
const detect = parseJson(detectRaw) || errorOf(detectRaw);

phase('analyze');
log('并行分析：根因与知识库经验');
const evidence = JSON.stringify({
  summary: detect.summary,
  checks: detect.checks,
  units: detect.units,
  plans: detect.plans,
  kbLookups: detect.kbLookups,
  planSummary: detect.planSummary,
  recurrences: detect.recurrences,
  repairParallel: detect.repairParallel
}).slice(0, 24000);

const analyses = await parallel([
  () =>
    agent(
      [
        '你是 Roban 机器人根因分析员，只能依据给定证据判断，不执行命令，不编造字段。',
        BASE,
        '请输出 Markdown：',
        '1. 故障单元与严重度（按 FAIL > WARN > UNKNOWN）；',
        '2. 每个单元最可能的根因、判断依据（引用证据字段）；',
        '3. 风险与安全提示（是否会误重启、是否需人工检查硬件）；',
        '4. 仍需人工确认的点。',
        '',
        '证据 JSON：',
        evidence
      ].join('\n'),
      { label: '根因与风险', phase: 'analyze' }
    ),
  () =>
    agent(
      [
        '你是 Roban 知识库分析员。读取本地经验库并解释本次命中情况，不执行修复。',
        BASE,
        '请先执行（只读）：',
        `cd "${CWD}" && ls kb/cases && cat kb/cases/*.json`,
        `cd "${CWD}" && tail -n 20 kb/events.jsonl 2>/dev/null || true`,
        '',
        '然后结合下面的检索结果输出 Markdown：',
        '1. 本次每个故障单元命中了哪条经验（score / source）、是否 degraded 或处于复发冷却；',
        '2. 该经验的历史成功率（stats）与最近事件（events.jsonl）；',
        '3. 若知识库未命中或经验不可用，说明会如何自行尝试；',
        '4. 本次学到什么、下次应如何调整。',
        '',
        '检索结果 JSON：',
        evidence
      ].join('\n'),
      { label: '知识库经验', phase: 'analyze' }
    )
]);

phase('apply');
let repair = detect;
let repairJson = null;
if (CONFIRM) {
  log('用户已确认：执行白名单修复 + 复检 + 写回知识库');
  const repairRaw = await agent(
    [
      '你是 Roban 修复执行代理。用户已明确确认执行白名单修复。',
      BASE,
      '执行前必须已读取 ATTENTION；不得执行重启机器人、关节断电或未批准的运动。',
      '执行（必须带 --confirm）：',
      `cd "${CWD}" && ${ENV_PREFIX}ROBAN_HOST=${HOST} node workflow/harness-adapter.example.js auto --confirm --json`,
      '',
      '该命令 stdout 只有一行 JSON（含 repairParallel/verify/kbWrite/reportPath）。',
      '请原样返回这一行 JSON，不要改写字段、不要补造内容。',
      '如果命令失败或计划被阻止（blocked），照实返回 JSON，不要绕过安全条件重试。'
    ].join('\n'),
    { label: '执行修复（已确认）', phase: 'apply' }
  );
  repairJson = parseJson(repairRaw) || errorOf(repairRaw);
  repair = repairJson;
} else {
  log('dry-run：不动机器人、不写知识库，复用检测阶段的预检结果');
}

phase('report');
log('读取报告并汇总');

const reportPath = repair.reportPath || detect.reportPath || null;
let reportSummary = '（本次没有生成报告文件）';
if (reportPath) {
  reportSummary = await agent(
    [
      '你是 Roban 报告解读员。读取报告文件并给出中文摘要，不要编造。',
      BASE,
      `报告路径：${reportPath}`,
      '请用 read/cat 读取该文件，然后输出 Markdown：',
      '1. 检测结论（OK/WARN/FAIL/UNKNOWN 与关键异常）；',
      '2. 知识库命中/计划来源、实际执行的动作与状态（dry-run 或 apply）；',
      '3. 复检结果与知识库更新（事件数、新增/更新案例）；',
      '4. 人工待办。',
      '不要执行任何修复命令。'
    ].join('\n'),
    { label: '报告解读', phase: 'report' }
  );
}

return {
  host: HOST,
  confirm: CONFIRM,
  safety: safetyReport,
  detect: {
    summary: detect.summary || null,
    planSummary: detect.planSummary || null,
    plans: detect.plans || [],
    kbLookups: detect.kbLookups || [],
    recurrences: detect.recurrences || [],
    error: detect.error || null
  },
  analyses: {
    rootCause: analyses[0],
    knowledgeBase: analyses[1]
  },
  repair: {
    mode: (repair.repairParallel && repair.repairParallel.mode) || (CONFIRM ? 'apply' : 'dry_run'),
    summary: (repair.repairParallel && repair.repairParallel.summary) || null,
    verify: repair.verify || null,
    kbWrite: repair.kbWrite || null,
    reportPath,
    error: repair.error || null
  },
  report: reportSummary
};
