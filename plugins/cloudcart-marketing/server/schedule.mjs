// The "Schedule this post" confirmation page.
// post_schedule only prepares a request and opens this page. Facebook is contacted only when
// the person presses the button here, so the assistant can never schedule anything by itself.
// Same safeguards as the connect page: this computer only, one-time secret link, short-lived.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { loadFacebook, schedulePhoto, MIN_LEAD_MS, MAX_LEAD_MS } from './facebook.mjs';

const LIFETIME_MS = 30 * 60 * 1000;
const pending = new Map(); // secret -> { dir, variant, image, caption, when, timer }
let server = null;

const fail = (message) => Object.assign(new Error(message), { expected: true });

function openInBrowser(url) {
  if (process.env.CLOUDCART_NO_BROWSER) return Promise.resolve(false);
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
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

function drop(secret) {
  const req = pending.get(secret);
  if (req) clearTimeout(req.timer);
  pending.delete(secret);
  if (!pending.size && server) {
    server.close();
    server.closeAllConnections?.();
    server = null;
  }
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Local "YYYY-MM-DDTHH:MM" for a datetime-local input. */
const localInput = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

function page(req, pageName) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Schedule this post</title>
<style>
  :root { --bg:#f6f6f4; --card:#fff; --text:#1c1c1a; --muted:#66665f; --line:#d9d9d2; --accent:#e03a40; --ok:#1d7a46; --err:#b3261e; }
  @media (prefers-color-scheme: dark) { :root { --bg:#161615; --card:#222220; --text:#f1f1ec; --muted:#a3a39a; --line:#3a3a36; --accent:#ff5c61; --ok:#5fd08d; --err:#ff8a80; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  main { max-width:520px; margin:0 auto; padding:32px 16px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px; overflow:hidden; }
  .pad { padding:20px 22px; }
  h1 { font-size:21px; margin:0 0 4px; }
  .sub { color:var(--muted); margin:0; }
  img { display:block; width:100%; height:auto; background:var(--bg); }
  .caption { white-space:pre-wrap; overflow-wrap:anywhere; padding:14px 22px; border-top:1px solid var(--line); border-bottom:1px solid var(--line); max-height:260px; overflow:auto; }
  label { display:block; font-weight:600; margin:0 0 6px; }
  input { width:100%; padding:11px 12px; font:inherit; color:var(--text); background:var(--bg); border:1px solid var(--line); border-radius:9px; }
  input:focus { outline:2px solid var(--accent); outline-offset:1px; }
  .hint { font-size:14px; color:var(--muted); margin:6px 0 0; }
  button { margin-top:18px; width:100%; padding:12px; font:inherit; font-weight:600; color:#fff; background:var(--accent); border:0; border-radius:9px; cursor:pointer; }
  button:disabled { opacity:.6; cursor:default; }
  #msg { margin-top:14px; min-height:24px; font-weight:600; color:var(--err); }
  #done { display:none; text-align:center; }
  #done .big { font-size:40px; color:var(--ok); }
  a { color:var(--accent); }
</style>
</head>
<body>
<main>
  <div class="card">
    <div id="formwrap">
      <div class="pad">
        <h1 data-t="title">Schedule this post</h1>
        <p class="sub"><span data-t="on">On the Facebook Page</span> <b>${esc(pageName)}</b></p>
      </div>
      <img src="${esc(req.path)}/image" alt="">
      <div class="caption">${esc(req.caption)}</div>
      <form id="form" class="pad">
        <label for="when" data-t="when">Date and time</label>
        <input id="when" name="when" type="datetime-local" required value="${esc(localInput(req.when))}">
        <div class="hint" data-t="hint">The post is scheduled, not published now. You can change or cancel it in Meta Business Suite until then.</div>
        <button id="btn" type="submit" data-t="button">Schedule</button>
        <div id="msg" role="status"></div>
      </form>
    </div>
    <div id="done" class="pad">
      <div class="big">✓</div>
      <h1 id="doneTitle"></h1>
      <p class="sub" id="doneLink"></p>
      <p class="sub" data-t="doneText">You can close this tab and go back to the chat.</p>
    </div>
  </div>
</main>
<script>
const T = {
  en: { title: 'Schedule this post', on: 'On the Facebook Page', when: 'Date and time',
        hint: 'The post is scheduled, not published now. You can change or cancel it in Meta Business Suite until then.',
        button: 'Schedule', working: 'Scheduling…', doneText: 'You can close this tab and go back to the chat.',
        done: (d) => 'Scheduled for ' + d, view: 'Open the scheduled post', expired: 'This page has expired. Go back to the chat and ask to schedule the post again.' },
  bg: { title: 'Насрочи този пост', on: 'Във Facebook страницата', when: 'Дата и час',
        hint: 'Постът се насрочва, не се публикува сега. Дотогава можеш да го промениш или отмениш в Meta Business Suite.',
        button: 'Насрочи', working: 'Насрочване…', doneText: 'Можеш да затвориш този раздел и да се върнеш в чата.',
        done: (d) => 'Насрочено за ' + d, view: 'Отвори насрочения пост', expired: 'Тази страница е изтекла. Върни се в чата и поискай отново насрочване.' },
};
const lang = (navigator.language || 'en').toLowerCase().startsWith('bg') ? 'bg' : 'en';
const t = T[lang];
document.title = t.title;
document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = t[el.dataset.t]; });
const form = document.getElementById('form'), btn = document.getElementById('btn'), msg = document.getElementById('msg');
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const at = new Date(form.when.value); // the browser's own time zone
  btn.disabled = true; btn.textContent = t.working; msg.textContent = '';
  let result;
  try {
    const res = await fetch(location.pathname, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ at: at.getTime() }) });
    result = await res.json();
  } catch { result = { ok: false, message: t.expired }; }
  if (result.ok) {
    document.getElementById('formwrap').style.display = 'none';
    document.getElementById('doneTitle').textContent = t.done(new Date(result.scheduled_for).toLocaleString(lang, { dateStyle: 'full', timeStyle: 'short' }));
    if (result.permalink) { const a = document.createElement('a'); a.href = result.permalink; a.target = '_blank'; a.rel = 'noopener'; a.textContent = t.view; document.getElementById('doneLink').append(a); }
    document.getElementById('done').style.display = 'block';
  } else { msg.textContent = result.message || t.expired; btn.disabled = false; btn.textContent = t.button; }
});
</script>
</body>
</html>`;
}

function readBody(req, limit = 4000) {
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

async function ensureServer() {
  if (server) return;
  const s = createServer(async (req, res) => {
    const port = s.address().port;
    const json = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(obj));
    };
    const [, secret, sub] = /^\/([0-9a-f]{48})(\/image)?$/.exec(req.url || '') || [];
    const pend = secret && pending.get(secret);
    if (req.headers.host !== `127.0.0.1:${port}` || !pend) {
      res.writeHead(404).end();
      return;
    }
    if (req.method === 'GET' && sub) {
      const type = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[extname(pend.image).toLowerCase()];
      res.writeHead(200, { 'Content-Type': type || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(readFileSync(pend.image));
      return;
    }
    if (req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
        'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'",
      });
      res.end(page({ ...pend, path: `/${secret}` }, loadFacebook().pageName || loadFacebook().pageId));
      return;
    }
    if (req.method === 'POST' && !sub) {
      const origin = req.headers.origin;
      if (!/^application\/json\b/.test(req.headers['content-type'] || '') || (origin && origin !== `http://127.0.0.1:${port}`)) {
        json(403, { ok: false, message: 'Not allowed.' });
        return;
      }
      if (pend.busy) {
        json(200, { ok: false, message: 'Already being scheduled.' });
        return;
      }
      let at;
      try {
        at = new Date(Number(JSON.parse(await readBody(req)).at));
      } catch {
        at = new Date(NaN);
      }
      if (Number.isNaN(at.getTime())) {
        json(200, { ok: false, message: 'Choose a date and time.' });
        return;
      }
      if (existsSync(join(pend.dir, 'scheduled.json'))) {
        json(200, { ok: false, message: 'This post is already scheduled.' });
        return;
      }
      pend.busy = true;
      try {
        const result = await schedulePhoto({ file: pend.image, caption: pend.caption, at });
        writeFileSync(join(pend.dir, 'scheduled.json'), JSON.stringify({ ...result, scheduled_at: new Date().toISOString(), image: pend.image }, null, 2));
        json(200, { ok: true, scheduled_for: result.scheduled_for, permalink: result.permalink });
        setTimeout(() => drop(secret), 500);
      } catch (e) {
        pend.busy = false;
        json(200, { ok: false, message: e.expected ? e.message : `Something went wrong: ${e.message}` });
      }
      return;
    }
    res.writeHead(405).end();
  });
  await new Promise((resolve, reject) => {
    s.once('error', reject);
    s.listen(0, '127.0.0.1', resolve);
  });
  server = s;
}

/**
 * Prepare a scheduling request for one variant and open the confirmation page.
 * variantDir must contain brief.json and at least one image_<n> file. Returns { url, opened, when }.
 */
export async function openSchedulePage({ variantDir, variant, when }) {
  const fb = loadFacebook();
  if (!fb.pageId || !fb.token) throw fail('Facebook is not set up yet. The user needs to add the Facebook Page ID and Page access token in the plugin settings (or on the connect page: call cloudcart_connect).');
  if (existsSync(join(variantDir, 'scheduled.json'))) {
    const done = JSON.parse(readFileSync(join(variantDir, 'scheduled.json'), 'utf8'));
    throw fail(`This variant is already scheduled for ${done.scheduled_for}. To change it, edit or cancel the scheduled post in Meta Business Suite.`);
  }
  const brief = JSON.parse(readFileSync(join(variantDir, 'brief.json'), 'utf8'));
  const shots = readdirSync(variantDir).filter((f) => /^image_\d+\./.test(f)).sort((a, b) => parseInt(a.slice(6), 10) - parseInt(b.slice(6), 10));
  if (!shots.length) throw fail('This variant has no image yet. Generate the image and call post_add_image first.');
  const at = when instanceof Date && !Number.isNaN(when.getTime()) ? when : new Date(Date.now() + 86_400_000);
  const lead = at.getTime() - Date.now();
  if (lead < MIN_LEAD_MS) throw fail('The time must be at least 20 minutes from now.');
  if (lead > MAX_LEAD_MS) throw fail('Facebook only accepts times within the next 29 days.');

  await ensureServer();
  const secret = randomBytes(24).toString('hex');
  const timer = setTimeout(() => drop(secret), LIFETIME_MS);
  timer.unref();
  pending.set(secret, { dir: variantDir, variant, image: join(variantDir, shots[shots.length - 1]), caption: brief.caption, when: at, timer });
  const url = `http://127.0.0.1:${server.address().port}/${secret}`;
  return { url, opened: await openInBrowser(url), when: at, page: fb.pageName || fb.pageId };
}
