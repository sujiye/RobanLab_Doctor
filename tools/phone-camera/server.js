'use strict';
/**
 * 手机相机测量页：零依赖本地 HTTP 服务。
 *
 * 手机和 Mac 在同一 Wi-Fi 下，打开终端打印的地址，拍照/选图，
 * 在页面上标出基座参考线和连杆方向，页面计算角度并上传 JSON。
 *
 * 运行：
 *   node tools/phone-camera/server.js
 *   PHONE_CAM_PORT=8787 CALIBRATION_DIR=./calibration/captures node tools/phone-camera/server.js
 *
 * 注意：这是人工测量辅助。手持手机、没有固定参考线时，单张照片不能给出绝对零位。
 */

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = Number(process.env.PHONE_CAM_PORT || 8787);
const CAPTURE_DIR = path.resolve(
  process.env.CALIBRATION_DIR || path.join(__dirname, '..', '..', 'calibration', 'captures')
);
const HTML_PATH = path.join(__dirname, 'public', 'index.html');
const MAX_BODY = 25 * 1024 * 1024;

fs.mkdirSync(CAPTURE_DIR, { recursive: true });

function lanAddresses() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    if (/^(utun|awdl|llw|bridge)/.test(name)) continue;
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('198.18.')) {
        out.push({ name, address: net.address });
      }
    }
  }
  return out;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function json(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Access-Control-Allow-Origin': '*'
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function saveCapture(payload) {
  const dataUrl = String(payload.imageDataUrl || '');
  const match = dataUrl.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/);
  if (!match) throw new Error('imageDataUrl 必须是 data:image/...;base64 格式');
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const buf = Buffer.from(match[2], 'base64');
  const stamp = timestamp();
  const imageFile = path.join(CAPTURE_DIR, `capture-${stamp}.${ext}`);
  fs.writeFileSync(imageFile, buf);

  const record = {
    createdAt: new Date().toISOString(),
    imageFile,
    imageBytes: buf.length,
    angleDeg: Number(payload.angleDeg),
    referenceAngleDeg: Number(payload.referenceAngleDeg),
    linkAngleDeg: Number(payload.linkAngleDeg),
    points: payload.points || null,
    note: String(payload.note || ''),
    instruction: '由用户确认测量结果；单张手持手机照片不能作为绝对零位真值。'
  };
  const jsonFile = path.join(CAPTURE_DIR, `capture-${stamp}.json`);
  fs.writeFileSync(jsonFile, JSON.stringify(record, null, 2) + '\n', 'utf8');
  return { ...record, jsonFile };
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      const html = fs.readFileSync(HTML_PATH);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    if (req.method === 'GET' && req.url === '/health') {
      json(res, 200, { ok: true, captureDir: CAPTURE_DIR, addresses: lanAddresses() });
      return;
    }
    if (req.method === 'POST' && req.url === '/api/capture') {
      const body = await readBody(req);
      const payload = JSON.parse(body.toString('utf8') || '{}');
      const record = saveCapture(payload);
      json(res, 200, { ok: true, ...record });
      return;
    }
    json(res, 404, { ok: false, error: 'not found' });
  } catch (err) {
    json(res, 400, { ok: false, error: err.message });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`phone-camera listening on port ${PORT}`);
  console.log(`capture dir: ${CAPTURE_DIR}`);
  const addresses = lanAddresses();
  if (!addresses.length) {
    console.log('在手机上打开: http://<本机局域网IP>:' + PORT);
  } else {
    for (const item of addresses) {
      console.log(`在手机上打开: http://${item.address}:${PORT}  (${item.name})`);
    }
  }
  console.log('手机和电脑必须在同一 Wi-Fi；页面只做人工测量，不直接控制机器人。');
});
