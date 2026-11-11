// Facebook Page access: schedule a photo post. This module can ONLY schedule
// (published=false with a future time). There is no code path that publishes immediately.
// It is called solely from the confirmation page (schedule.mjs), after the user presses the button.
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { CONFIG_DIR } from './lib.mjs';

const GRAPH = 'https://graph.facebook.com/v27.0';
const FB_FILE = join(CONFIG_DIR, 'facebook.json');
const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // Facebook's limit for photos
export const MIN_LEAD_MS = 20 * 60 * 1000; // Facebook needs at least 10 minutes; leave a margin
export const MAX_LEAD_MS = 29 * 86_400_000; // Facebook's documented maximum is 30 days

const fail = (message) => Object.assign(new Error(message), { expected: true });

export function loadFacebook() {
  let file = {};
  try {
    file = JSON.parse(readFileSync(FB_FILE, 'utf8'));
  } catch {
    // not set up
  }
  return {
    pageId: String(process.env.FB_PAGE_ID || file.pageId || '').trim(),
    token: String(process.env.FB_PAGE_TOKEN || file.token || '').trim(),
    pageName: file.pageName || '',
  };
}

export function saveFacebook({ pageId, token, pageName }) {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(FB_FILE, JSON.stringify({ pageId: pageId || '', token: token || '', pageName: pageName || '' }, null, 2) + '\n', { mode: 0o600 });
}

export const facebookReady = () => {
  const fb = loadFacebook();
  return !!(fb.pageId && fb.token);
};

function explain(error, status) {
  const code = error?.code;
  if (code === 190) return 'Facebook says the access token is invalid or has expired. Create a new Page access token and save it in the plugin settings.';
  if (code === 200 || code === 10 || code === 283) return 'The Facebook token is not allowed to post on this Page. It needs the pages_manage_posts and pages_read_engagement permissions, from a person who can create content on the Page.';
  if (code === 324) return 'Facebook did not accept the image file.';
  if (code === 368) return 'Facebook temporarily blocked this action for the Page. Try again later.';
  if (code === 100) return `Facebook rejected the request: ${error.message}`;
  return `Facebook returned an error${status ? ` (HTTP ${status})` : ''}: ${error?.message || 'unknown error'}`;
}

async function graph(path, { method = 'GET', params, body } = {}) {
  const url = new URL(`${GRAPH}${path}`);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  let res;
  try {
    res = await fetch(url, { method, body, signal: AbortSignal.timeout(120_000), redirect: 'error' });
  } catch (e) {
    throw fail(`Could not reach Facebook: ${e.message}`);
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    // not JSON
  }
  if (!res.ok || json?.error) throw fail(explain(json?.error, res.status));
  return json;
}

/**
 * Check the Page ID and token and return { pageId, pageName, token }. A user token that manages
 * the Page is exchanged for the Page's own token, which is what posting requires.
 */
export async function verifyFacebook(pageId, token) {
  if (!/^\d{5,25}$/.test(String(pageId || ''))) throw fail('The Facebook Page ID should be a number (Page → About → Page transparency, or Meta Business Suite → Settings).');
  if (!token) throw fail('A Facebook Page access token is needed.');
  const page = await graph(`/${pageId}`, { params: { fields: 'id,name,access_token', access_token: token } });
  return { pageId: String(page.id), pageName: page.name || '', token: page.access_token || token };
}

/**
 * Schedule a photo post. `at` is a Date. Returns { post_id, photo_id, permalink, scheduled_for }.
 * Always scheduled, never published now.
 */
export async function schedulePhoto({ file, caption, at }) {
  const fb = loadFacebook();
  if (!fb.pageId || !fb.token) throw fail('Facebook is not set up yet. Add the Page ID and Page access token in the plugin settings.');
  const lead = at.getTime() - Date.now();
  if (!(lead >= MIN_LEAD_MS)) throw fail('The time must be at least 20 minutes from now.');
  if (lead > MAX_LEAD_MS) throw fail('The time must be within the next 29 days.');
  const size = statSync(file).size;
  if (size > MAX_PHOTO_BYTES) throw fail('The image is larger than 10 MB, which Facebook does not accept.');

  // Meta's documented way to schedule a post with a photo, in two steps:
  // 1) upload the photo without publishing it, 2) create the scheduled Page post that carries it.
  // (A single scheduled /photos call creates a photo with no timeline post, which Meta Business Suite does not list.)
  const upload = new FormData();
  upload.set('access_token', fb.token);
  upload.set('published', 'false'); // never publish immediately
  upload.set('temporary', 'true');
  const type = /\.jpe?g$/i.test(file) ? 'image/jpeg' : /\.webp$/i.test(file) ? 'image/webp' : 'image/png';
  upload.set('source', new Blob([readFileSync(file)], { type }), basename(file));
  const photo = await graph(`/${fb.pageId}/photos`, { method: 'POST', body: upload });

  const post = new FormData();
  post.set('access_token', fb.token);
  post.set('message', caption);
  post.set('attached_media[0]', JSON.stringify({ media_fbid: photo.id }));
  post.set('published', 'false'); // never publish immediately
  post.set('scheduled_publish_time', String(Math.floor(at.getTime() / 1000)));
  post.set('unpublished_content_type', 'SCHEDULED');
  const created = { ...(await graph(`/${fb.pageId}/feed`, { method: 'POST', body: post })), photo_id: photo.id };
  const postId = created.id;
  // Read it back so we report what Facebook actually stored.
  let check = {};
  try {
    check = await graph(`/${postId}`, { params: { fields: 'is_published,scheduled_publish_time,permalink_url', access_token: fb.token } });
  } catch {
    // the post was created; details are a bonus
  }
  if (check.is_published === true) throw fail('Facebook published the post immediately instead of scheduling it. Check the Page now.');
  return {
    post_id: postId,
    photo_id: created.photo_id,
    permalink: check.permalink_url || null,
    scheduled_for: new Date((check.scheduled_publish_time ? Number(check.scheduled_publish_time) : Math.floor(at.getTime() / 1000)) * 1000).toISOString(),
    page: fb.pageName || fb.pageId,
  };
}
