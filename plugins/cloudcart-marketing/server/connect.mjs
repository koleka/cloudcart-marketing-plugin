// The "Connect your CloudCart store" page.
// Starts a short-lived web server on this computer only (127.0.0.1), opens it
// in the browser, and saves what the user enters. The API key goes from the
// browser straight to this process and into the config file: never into chat.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { loadConfig, checkConnection, saveConfig } from './lib.mjs';
import { parseDriveId, installFromLink, librarySource, getLibraryLink } from './library-sync.mjs';

const LIFETIME_MS = 15 * 60 * 1000;
let active = null; // { url, server, timer }

function close() {
  if (!active) return;
  clearTimeout(active.timer);
  active.server.close();
  active.server.closeAllConnections?.();
  active = null;
}

function openInBrowser(url) {
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
      child.on('error', () => resolve(false));
      child.on('spawn', () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function page(currentStore, hasKey, currentLibrary) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect your CloudCart store</title>
<style>
  :root { --bg:#f6f6f4; --card:#fff; --text:#1c1c1a; --muted:#66665f; --line:#d9d9d2; --accent:#e03a40; --ok:#1d7a46; --err:#b3261e; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#161615; --card:#222220; --text:#f1f1ec; --muted:#a3a39a; --line:#3a3a36; --accent:#ff5c61; --ok:#5fd08d; --err:#ff8a80; }
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  main { max-width:480px; margin:0 auto; padding:48px 16px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:28px; }
  h1 { font-size:22px; margin:0 0 6px; }
  p { margin:0 0 18px; color:var(--muted); }
  label { display:block; font-weight:600; margin:18px 0 6px; }
  .hint { font-size:14px; color:var(--muted); margin:6px 0 0; }
  .opt { font-weight:400; color:var(--muted); }
  #libnote { margin-top:10px; font-weight:600; }
  #libnote.warn { color:var(--err); } #libnote.good { color:var(--ok); }
  input { width:100%; padding:11px 12px; font:inherit; color:var(--text); background:var(--bg); border:1px solid var(--line); border-radius:9px; }
  input:focus { outline:2px solid var(--accent); outline-offset:1px; }
  button { margin-top:24px; width:100%; padding:12px; font:inherit; font-weight:600; color:#fff; background:var(--accent); border:0; border-radius:9px; cursor:pointer; }
  button:disabled { opacity:.6; cursor:default; }
  #msg { margin-top:16px; min-height:24px; font-weight:600; }
  #msg.err { color:var(--err); } #msg.ok { color:var(--ok); }
  .foot { font-size:14px; color:var(--muted); margin-top:18px; }
  #done { display:none; text-align:center; }
  #done .big { font-size:40px; color:var(--ok); }
</style>
</head>
<body>
<main>
  <div class="card">
    <form id="form" autocomplete="off">
      <h1 data-t="title">Connect your CloudCart store</h1>
      <p data-t="intro">The assistant will be able to read your products, orders and customers. It cannot change anything in the store.</p>

      <label for="store" data-t="storeLabel">Store address</label>
      <input id="store" name="store" required placeholder="mystore.cloudcart.com" value="${escapeHtml(currentStore || '')}" spellcheck="false" autocapitalize="off">

      <label for="key" data-t="keyLabel">API key</label>
      <input id="key" name="key" type="password" ${hasKey ? '' : 'required'} autocomplete="off" spellcheck="false" data-saved="${hasKey ? '1' : ''}">
      <div class="hint" data-t="keyHint">In your CloudCart admin: Settings → API Keys → Create API Key.</div>

      <label for="library"><span data-t="libLabel">Post library link</span> <span class="opt" data-t="optional">(optional)</span></label>
      <input id="library" name="library" placeholder="https://drive.google.com/file/d/…" value="${escapeHtml(currentLibrary || '')}" spellcheck="false" autocapitalize="off">
      <div class="hint" data-t="libHint">A Google Drive link to your past posts. With it, new posts follow your page's own voice and look.</div>

      <button id="btn" type="submit" data-t="button">Connect</button>
      <div id="msg" role="status"></div>
      <div class="foot" data-t="foot">The key is saved only on this computer. It is not sent to the chat.</div>
    </form>
    <div id="done">
      <div class="big">✓</div>
      <h1 id="doneTitle"></h1>
      <div id="libnote"></div>
      <p data-t="doneText">You can close this tab and go back to the chat.</p>
    </div>
  </div>
</main>
<script>
const T = {
  en: {
    title: 'Connect your CloudCart store',
    intro: 'The assistant will be able to read your products, orders and customers. It cannot change anything in the store.',
    storeLabel: 'Store address', keyLabel: 'API key',
    keyHint: 'In your CloudCart admin: Settings → API Keys → Create API Key.',
    button: 'Connect', checking: 'Checking…', downloading: 'Checking and downloading the library… this can take a minute',
    libLabel: 'Post library link', optional: '(optional)',
    libHint: 'A Google Drive link to your past posts. With it, new posts follow your page\'s own voice and look.',
    keySaved: 'A key is already saved. Leave empty to keep it.',
    libOk: (n) => 'Post library downloaded: ' + n + ' posts.',
    libFail: 'The store is connected, but the post library could not be downloaded. Check the link and that the file is shared as "Anyone with the link".',
    bad_library: 'The post library link is not a Google Drive file link.',
    foot: 'The key is saved only on this computer. It is not sent to the chat.',
    doneText: 'You can close this tab and go back to the chat.',
    connected: (s) => 'Connected to ' + s,
    bad_store: 'That does not look like a store address.',
    bad_key: 'The store did not accept this key. Check that you copied all of it.',
    bad_response: 'The store did not answer as expected. Check the store address.',
    unreachable: 'Could not reach the store. Check the address and your internet connection.',
    expired: 'This page has expired. Go back to the chat and ask to connect the store again.',
  },
  bg: {
    title: 'Свържете вашия CloudCart магазин',
    intro: 'Асистентът ще може да чете вашите продукти, поръчки и клиенти. Не може да променя нищо в магазина.',
    storeLabel: 'Адрес на магазина', keyLabel: 'API ключ',
    keyHint: 'В администрацията на CloudCart: Настройки → API ключове → Създай API ключ.',
    button: 'Свържи', checking: 'Проверка…', downloading: 'Проверка и изтегляне на библиотеката… може да отнеме минута',
    libLabel: 'Линк към библиотеката с постове', optional: '(по желание)',
    libHint: 'Google Drive линк към предишните ви постове. С него новите постове следват гласа и визията на вашата страница.',
    keySaved: 'Вече има записан ключ. Оставете празно, за да го запазите.',
    libOk: (n) => 'Библиотеката с постове е изтеглена: ' + n + ' поста.',
    libFail: 'Магазинът е свързан, но библиотеката с постове не можа да се изтегли. Проверете линка и дали файлът е споделен с „Всеки с линка“.',
    bad_library: 'Линкът към библиотеката не е Google Drive линк към файл.',
    foot: 'Ключът се записва само на този компютър. Не се изпраща в чата.',
    doneText: 'Можете да затворите този раздел и да се върнете в чата.',
    connected: (s) => 'Свързано с ' + s,
    bad_store: 'Това не прилича на адрес на магазин.',
    bad_key: 'Магазинът не прие този ключ. Проверете дали сте го копирали целия.',
    bad_response: 'Магазинът не отговори както се очаква. Проверете адреса.',
    unreachable: 'Няма връзка с магазина. Проверете адреса и интернет връзката.',
    expired: 'Тази страница е изтекла. Върнете се в чата и поискайте отново свързване на магазина.',
  },
};
const t = T[(navigator.language || 'en').toLowerCase().startsWith('bg') ? 'bg' : 'en'];
document.title = t.title;
document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = t[el.dataset.t]; });
if (document.getElementById('key').dataset.saved) document.getElementById('key').placeholder = t.keySaved;

const form = document.getElementById('form'), btn = document.getElementById('btn'), msg = document.getElementById('msg');
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  btn.disabled = true; btn.textContent = form.library.value.trim() ? t.downloading : t.checking; msg.className = ''; msg.textContent = '';
  let result;
  try {
    const res = await fetch(location.pathname, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ store: form.store.value, apiKey: form.key.value, libraryUrl: form.library.value }),
    });
    result = await res.json();
  } catch {
    result = { ok: false, reason: 'expired' };
  }
  if (result.ok) {
    form.style.display = 'none';
    document.getElementById('doneTitle').textContent = t.connected(result.store);
    const note = document.getElementById('libnote');
    if (result.library && result.library.ok) { note.className = 'good'; note.textContent = t.libOk(result.library.posts); }
    else if (result.library) { note.className = 'warn'; note.textContent = t.libFail; }
    document.getElementById('done').style.display = 'block';
  } else {
    msg.className = 'err'; msg.textContent = t[result.reason] || t.bad_response;
    btn.disabled = false; btn.textContent = t.button;
  }
});
</script>
</body>
</html>`;
}

function readBody(req, limit = 10_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Start (or reuse) the page and open it. Resolves to { url, opened }. */
export async function openConnectPage() {
  if (!active) {
    const secret = randomBytes(24).toString('hex');
    const server = createServer(async (req, res) => {
      const port = server.address().port;
      const json = (code, obj) => {
        res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(obj));
      };
      // Only this exact local address, and only with the one-time secret in the path.
      if (req.headers.host !== `127.0.0.1:${port}` || req.url !== `/${secret}`) {
        res.writeHead(404).end();
        return;
      }
      if (req.method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
          'X-Frame-Options': 'DENY',
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'",
        });
        const saved = loadConfig();
        res.end(page(saved.store, !!saved.apiKey, getLibraryLink()));
        return;
      }
      if (req.method === 'POST') {
        // A JSON content type cannot be sent cross-site without a preflight, which we never grant.
        const origin = req.headers.origin;
        if (!/^application\/json\b/.test(req.headers['content-type'] || '') || (origin && origin !== `http://127.0.0.1:${port}`)) {
          json(403, { ok: false, reason: 'bad_response' });
          return;
        }
        let body;
        try {
          body = JSON.parse(await readBody(req));
        } catch {
          json(400, { ok: false, reason: 'bad_response' });
          return;
        }
        // An empty key field means "keep the saved key".
        const apiKey = String(body?.apiKey || '').trim() || loadConfig().apiKey;
        const libraryUrl = String(body?.libraryUrl || '').trim();
        if (libraryUrl && !parseDriveId(libraryUrl)) {
          json(200, { ok: false, reason: 'bad_library' });
          return;
        }
        const check = await checkConnection(body?.store, apiKey);
        if (!check.ok) {
          json(200, { ok: false, reason: check.reason });
          return;
        }
        try {
          saveConfig({ store: check.store, apiKey });
        } catch {
          json(200, { ok: false, reason: 'bad_response' });
          return;
        }
        // The store is connected either way; the library is a bonus and may fail on its own.
        let library;
        if (libraryUrl && libraryUrl !== librarySource()?.url) {
          try {
            library = { ok: true, posts: (await installFromLink(libraryUrl)).posts };
          } catch {
            library = { ok: false };
          }
        }
        json(200, { ok: true, store: check.store, library });
        setTimeout(close, 500); // one successful use, then the page is gone
        return;
      }
      res.writeHead(405).end();
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const timer = setTimeout(close, LIFETIME_MS);
    timer.unref();
    active = { url: `http://127.0.0.1:${server.address().port}/${secret}`, server, timer };
  }
  const url = active.url;
  const opened = process.env.CLOUDCART_NO_BROWSER ? false : await openInBrowser(url);
  return { url, opened };
}
