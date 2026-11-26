'use strict';
/**
 * ssh-run —— 通过 SSH 在机器人上执行命令（默认密钥认证，无明文口令）。
 *
 * 约定：
 *   ctx.remote = { host, user='lemon', port=22, proxy? }
 *   ctx.log(msg, data?)
 *
 * 用法：
 *   await sshRun.run(ctx, { command: 'hostname' });
 *   await sshRun.run(ctx, { command: 'bash -s', input: script }); // 长脚本走 stdin
 *
 * 为什么长脚本走 stdin：避免 shell 引号转义和命令行长度限制；probe/repair 都这样做。
 */

const { spawn } = require('child_process');
const safety = require('./safety.js');

const id = 'ssh-run';
const title = '机器人 SSH 执行（密钥认证）';
const description = '返回 {code, stdout, stderr}；只读命令默认直接执行，写操作由上层确认';
const inputs = {
  command: 'string，远程执行的命令；长脚本建议用 bash -s',
  input: 'string|null，可选，写入远程 stdin 的内容',
  timeoutMs: 'number，默认 60000'
};

function shQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function sshArgs(remote, command) {
  if (!remote || !remote.host) {
    throw new Error('ctx.remote.host 未配置：请让用户提供当前机器人 IP（不得从知识库/历史记录读取）');
  }
  const args = [
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=8',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'LogLevel=ERROR'
  ];
  if (remote.port) args.push('-p', String(remote.port));
  if (remote.proxy) {
    args.push('-o', `ProxyCommand=nc -X 5 -x ${remote.proxy} %h %p`);
  }
  args.push(`${remote.user || 'lemon'}@${remote.host}`, command);
  return args;
}

async function run(ctx, { command, input = null, timeoutMs = 60000 } = {}) {
  if (!command) throw new Error('ssh-run 需要 command');
  if (!ctx || !ctx.remote) throw new Error('ctx.remote 未配置');

  // 每次真正发起远程命令前都重新读取 ATTENTION；缺失/为空会直接抛错。
  const rules = safety.loadRules(ctx);
  ctx.log(
    `[safety] ATTENTION ${rules.path} sha256=${rules.sha256.slice(0, 12)} ` +
    `at=${rules.loadedAt}`
  );
  ctx.log(`[ssh] ${String(command).slice(0, 120)}`);
  return new Promise((resolve, reject) => {
    const child = spawn('ssh', sshArgs(ctx.remote, command), {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`ssh-run 超时（${timeoutMs}ms）：${String(command).slice(0, 80)}`));
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(input == null ? '' : input);
  });
}

async function must(ctx, command, opts = {}) {
  const res = await run(ctx, { command, ...opts });
  if (res.code !== 0) {
    throw new Error(
      `远程命令失败(code=${res.code}): ${command}\n${res.stderr.slice(-2000)}`
    );
  }
  return res.stdout;
}

module.exports = { id, title, description, inputs, run, must, shQuote };
