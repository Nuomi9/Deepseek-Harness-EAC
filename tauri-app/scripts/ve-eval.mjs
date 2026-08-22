// V-E 一次性验证脚本：经 CDP 向页面执行任意表达式（默认写入测试 localStorage 键）。
// 用法: node ve-eval.mjs <cdpPort> [expression]
const port = process.argv[2] || '9231';
const exprArg = process.argv[3] || '';
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = list.find((t) => t.type === 'page' && /127\.0\.0\.1:\d+/.test(t.url));
if (!page) { console.error('未找到 dsh 页面 target:', list.map((t) => t.url)); process.exit(1); }
console.log('target:', page.url);
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const send = (id, method, params) => ws.send(JSON.stringify({ id, method, params }));
const waitMsg = (id) => new Promise((res) => {
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id === id) res(m); };
});
send(1, 'Runtime.enable', {});
const expr = exprArg || `(() => {
  localStorage.setItem('dsh-ve-test', 'survivor-20260822');
  localStorage.setItem('dsh-ve-json', JSON.stringify({ nested: { a: 1 }, list: [1,2,3] }));
  return JSON.stringify({ a: localStorage.getItem('dsh-ve-test'), b: localStorage.getItem('dsh-ve-json') });
})()`;
send(2, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: 120000 });
const r = await waitMsg(2);
console.log('结果:', JSON.stringify(r.result?.result?.value ?? r.result));
ws.close();
process.exit(0);
