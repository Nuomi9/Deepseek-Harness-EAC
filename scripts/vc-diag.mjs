// vc-diag.mjs — V-C 深度诊断：检查 __TAURI__ 命名空间与自有命令调用的真实报错。
import http from 'node:http';

const CDP = Number(process.argv[2] || 9223);
function getJSON(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: CDP, path }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
const pages = (await getJSON('/json')).filter((t) => t.type === 'page' && /^http:\/\/127\.0\.0\.1/.test(t.url));
if (!pages.length) { console.error('未找到 Web UI 页面目标'); process.exit(1); }
const ws = new WebSocket(pages[0].webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(String(m.data));
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
};
const send = (method, params) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evalx = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return 'EXC: ' + (r.result.exceptionDetails.exception?.description || '');
  return r.result?.result?.value;
};

console.log('1) __TAURI__ keys =', await evalx(`Object.keys(window.__TAURI__ || {}).join(',')`));
console.log('2) has window ns  =', await evalx(`!!(window.__TAURI__ && window.__TAURI__.window)`));
console.log('3) chrome_init    =', await evalx(
  `window.__TAURI__.core.invoke('chrome_init').then((v) => JSON.stringify(v).slice(0, 240)).catch((e) => 'ERR: ' + String(e))`,
));
console.log('4) icon src       =', await evalx(`(document.querySelector('#__dsh_desktop_chrome__ .dch-icon')||{}).src?.slice(0,60)`));
console.log('5) badge text     =', await evalx(`(document.querySelector('#__dsh_desktop_chrome__ .dch-badge')||{}).textContent`));
console.log('6) location       =', await evalx(`location.origin`));
ws.close();
process.exit(0);
