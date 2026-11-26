'use strict';
/**
 * 泛用视觉诊断 CLI。
 *
 * 用法：
 *   ROBAN_HOST=<ROBOT_IP> node workflow/visual-diagnosis-adapter.js \
 *     --description "右臂抬不起来" --image ./a.jpg --observations ./vision.json
 *
 *   # 没有机器人连接时也可以只基于描述/图片诊断：
 *   node workflow/visual-diagnosis-adapter.js --description "相机黑屏" --image ./camera.jpg
 *
 * observations 由具备视觉能力的 agent 看图后填写，schema 见
 * templates/vision-observations.example.json。
 *
 * 本工具不执行运动、不重启机器人、不上电/卸力、不写 offset；
 * 只有白名单安全动作（restart-chin-camera）在用户 --confirm 后才会执行。
 */

const fs = require('fs');
const path = require('path');
const { makeCtx } = require('./harness-adapter.example.js');
const { TASKS, runTask } = require('./general-diagnosis-workflow.js');

function argValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function argValues(argv, name) {
  const values = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === name && argv[i + 1]) values.push(argv[i + 1]);
  }
  return values;
}

function usage() {
  console.log([
    '用法:',
    '  [ROBAN_HOST=<ROBOT_IP>] node workflow/visual-diagnosis-adapter.js \\',
    '    --description "<自然语言描述>" [--part arm] [--since "..."] [--recent "..."] [--error "..."] \\',
    '    [--image <path>]... [--capture <capture.json>]... [--observations <vision.json>] [--confirm] [--json]',
    '',
    '说明：',
    '  - 有 ROBAN_HOST 时追加只读 probe/selfcheck；没有也能只基于描述/图片诊断。',
    '  - observations 必须由视觉模型看图后填写，不能编造。',
    '  - 只有 restart-chin-camera 是白名单安全动作，且 --confirm 才执行。',
    '  - 运动/重启/关节断电/写 offset 一律不自动执行。'
  ].join('\n'));
}

function loadObservations(file) {
  if (!file) return null;
  const abs = path.isAbsolute(file) ? file : path.resolve(process.cwd(), file);
  return JSON.parse(fs.readFileSync(abs, 'utf8'));
}

async function main() {
  const argv = process.argv.slice(2);
  const description = argValue(argv, '--description') || '';
  const images = argValues(argv, '--image');
  const captures = argValues(argv, '--capture');
  const observationsFile = argValue(argv, '--observations');
  const confirm = argv.includes('--confirm');
  const jsonOut = argv.includes('--json');

  if (!description && !images.length && !captures.length) {
    usage();
    process.exit(2);
  }

  const ctx = makeCtx({ quiet: jsonOut });
  ctx.diagnosisDir = path.join(__dirname, '..', 'diagnosis');
  const visionObservations = loadObservations(observationsFile);

  const state = {
    description,
    part: argValue(argv, '--part') || null,
    since: argValue(argv, '--since') || null,
    recentChanges: argValue(argv, '--recent') || null,
    errorText: argValue(argv, '--error') || null,
    images,
    captures,
    visionObservations,
    confirmRepair: confirm,
    skipProbe: !ctx.remote.host
  };

  const result = await runTask(ctx, TASKS['roban-general-diagnosis'], { until: 'report', state });
  const out = result.state;

  if (jsonOut) {
    console.log(JSON.stringify({
      symptom: out.symptom || null,
      visualEvidence: out.visualEvidence
        ? {
            ready: out.visualEvidence.ready,
            images: out.visualEvidence.images,
            captures: out.visualEvidence.captures,
            hasObservations: out.visualEvidence.hasObservations,
            missing: out.visualEvidence.missing
          }
        : null,
      summary: out.summary || null,
      generalDiagnosis: out.generalDiagnosis || null,
      repair: out.repair || null,
      reportPath: out.generalReport && out.generalReport.path ? out.generalReport.path : null
    }, null, 2));
    return;
  }

  if (out.generalReport && out.generalReport.markdown) {
    console.log('\n' + out.generalReport.markdown);
  } else {
    console.log(JSON.stringify({
      symptom: out.symptom,
      generalDiagnosis: out.generalDiagnosis,
      reportPath: out.generalReport && out.generalReport.path
    }, null, 2));
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[fatal]', err.message);
    process.exit(1);
  });
}
