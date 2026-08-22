// vc-check.mjs — V-C 真机点检：经 CDP 连 WebView2 执行点检清单。
// 用法: node scripts/vc-check.mjs [--cdp 9222] [--wait-seconds 300] [--quit]
// 前提: 应用以 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<cdp> 启动。
// 输出: stdout 打印 JSON 点检表；--quit 时点检完经自有命令优雅退出。

import http from 'node:http';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? String(args[i + 1] ?? '') : dflt;
};
const hasFlag = (name) => args.includes(name);
const CDP_PORT = Number(opt('--cdp', 9222));
const WAIT_MS = Number(opt('--wait-seconds', 300)) * 1000;
const DO_QUIT = hasFlag('--quit');

function getJSON(path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: CDP_PORT, path }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => {
        try { resolve(JSON.parse(b)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(2000, () => req.destroy(new Error('timeout')));
  });
}

async function waitPages() {
  const deadline = Date.now() + WAIT_MS;
  let lastErr = '';
  let lastList = [];
  while (Date.now() < deadline) {
    try {
      const list = await getJSON('/json');
      lastList = list;
      const pages = list.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      // 主窗目标：优先已导航到 Web UI 的；否则本地壳页；跳过 about:blank 过渡目标。
      const preferred =
        pages.find((p) => /^http:\/\/127\.0\.0\.1:\d+/.test(p.url)) ||
        pages.find((p) => /tauri/i.test(p.url) || /^http:\/\/localhost/.test(p.url));
      if (preferred) return [preferred];
      if (pages.length) lastList = pages;
    } catch (e) {
      lastErr = String(e.message || e);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('CDP 等待超时: ' + lastErr + ' | 最后目标: ' + JSON.stringify(lastList.map((t) => t.url)));
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.onopen = () =>
      resolve({
        send(method, params) {
          return new Promise((res) => {
            const mid = ++id;
            pending.set(mid, res);
            ws.send(JSON.stringify({ id: mid, method, params }));
          });
        },
        close() { try { ws.close(); } catch { /* ignore */ } },
      });
    ws.onerror = () => reject(new Error('WebSocket 连接失败: ' + wsUrl));
    ws.onmessage = (m) => {
      const msg = JSON.parse(String(m.data));
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    };
  });
}

async function evaluate(c, expr) {
  const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) {
    return { __exception: r.result.exceptionDetails.exception?.description || 'exception' };
  }
  return r.result?.result?.value;
}

const checks = [];
const add = (name, value, expect = true) => {
  const ok = value === expect || (expect === true && value === true);
  checks.push({ name, ok, detail: typeof value === 'object' ? JSON.stringify(value) : String(value) });
};

const pages = await waitPages();
console.error('[vc] CDP targets:');
for (const p of pages) console.error(`  - ${p.title} @ ${p.url}`);

// 主目标：优先 Web UI（127.0.0.1），否则本地壳页。
const target =
  pages.find((p) => /^http:\/\/127\.0\.0\.1:\d+/.test(p.url)) ||
  pages.find((p) => /tauri/i.test(p.url)) ||
  pages[0];
const c = await connect(target.webSocketDebuggerUrl);

// 等待注入桥 + 自绘标题栏就绪（首启含 pnpm 安装，可能较久）。
{
  const deadline = Date.now() + Math.min(WAIT_MS, 180000);
  let readyAt = null;
  while (Date.now() < deadline) {
    const ready = await evaluate(c, `!!window.dshDesktop && !!document.getElementById('__dsh_desktop_chrome__')`);
    if (ready === true) { readyAt = Date.now(); break; }
    await new Promise((r) => setTimeout(r, 500));
  }
  add('注入桥+标题栏就绪', readyAt != null, true);
}

add('window.dshDesktop 存在', await evaluate(c, `!!window.dshDesktop`));
add('标题栏 DOM 已注入', await evaluate(c, `!!document.getElementById('__dsh_desktop_chrome__')`));
add(
  '标题栏图标已渲染',
  await evaluate(
    c,
    `(() => { const i = document.querySelector('#__dsh_desktop_chrome__ .dch-icon'); return !!i && !!i.src && (/^data:image/.test(i.src) || i.complete); })()`,
  ),
);
add(
  '版本徽标可见',
  await evaluate(
    c,
    `(() => { const b = document.querySelector('#__dsh_desktop_chrome__ .dch-badge'); return !!b && !b.hidden && /v\\d/.test(b.textContent || ''); })()`,
  ),
);
add(
  'chrome_init 返回 desktopShell=tauri（自有命令正常）',
  await evaluate(c, `window.dshDesktop.getInfo().then((i) => !!(i && i.desktopShell === 'tauri')).catch(() => false)`),
);

// V-A 验收：远程上下文 core:window:* 已撤，核心 API 应被 ACL 拒绝。
// Tauri v2 API 形态：__TAURI__.window.getCurrentWindow().minimize()。
// 结果语义：true=被拒（预期）；NOT_DENIED=竟能调用（严重）；NOT_INJECTED=API 不存在（环境异常）。
const vaCheck = (api) => `(async () => {
  try {
    const w = window.__TAURI__ && window.__TAURI__.window && window.__TAURI__.window.getCurrentWindow && window.__TAURI__.window.getCurrentWindow();
    if (!w || typeof w.${api} !== 'function') return 'NOT_INJECTED';
    await w.${api}();
    return 'NOT_DENIED';
  } catch (e) { return true; }
})()`;
add('V-A: __TAURI__ 已注入', await evaluate(c, `!!window.__TAURI__`));
add('V-A: __TAURI__.window.minimize 被拒', await evaluate(c, vaCheck('minimize')));
add('V-A: __TAURI__.window.close 被拒', await evaluate(c, vaCheck('close')));

// Web UI 形态冒烟（本地壳页时这两项会失败——以 Web UI 目标为准）。
add(
  'Web UI 根节点存在',
  await evaluate(c, `!!document.querySelector('#root, #app, [id*="app"], body > div:not(#__dsh_desktop_chrome__)')`),
);
add(
  '可交互输入控件存在',
  await evaluate(c, `!!document.querySelector('textarea, [contenteditable="true"], input[type="text"]')`),
);

if (DO_QUIT) {
  console.error('[vc] 经菜单命令优雅退出…');
  await evaluate(c, `try { window.dshDesktop.menu.action('quit'); } catch {}`);
  await new Promise((r) => setTimeout(r, 1500));
  c.close();
} else {
  c.close();
}

console.log(JSON.stringify({ target: { title: target.title, url: target.url }, checks }, null, 2));
process.exit(0);
