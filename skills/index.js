'use strict';
/**
 * skill 注册表。每个 skill 都是同构模块：
 *   module.exports = { id, title, description, inputs, run(ctx, input) }
 *
 * 增加新能力（关节调试、参数调节、遥控）时，照抄一个文件并在下面注册。
 */

const SKILL_FILES = [
  './safety.js',
  './ssh-run.js',
  './env-probe.js',
  './selfcheck.js',
  './official-baseline.js',
  './diagnose.js',
  './symptom-intake.js',
  './visual-evidence.js',
  './general-hypothesis.js',
  './general-report.js',
  './joint-positions.js',
  './joint-identify.js',
  './calibration-plan.js',
  './calibration-measure.js',
  './calibration-offset.js',
  './calibration-verify.js',
  './calibration-report.js',
  './repair.js',
  './verify.js',
  './repair-plan.js',
  './repair-parallel.js',
  './learn.js',
  './report.js'
];

const registry = new Map();
for (const rel of SKILL_FILES) {
  const skill = require(rel);
  registry.set(skill.id, skill);
}

function get(id) {
  return registry.get(id);
}

function list() {
  return [...registry.values()].map((s) => ({
    id: s.id,
    title: s.title,
    description: s.description,
    inputs: s.inputs
  }));
}

module.exports = { get, list, registry };
