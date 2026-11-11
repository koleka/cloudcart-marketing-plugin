// Install and refresh the post library from a zip shared on Google Drive
// ("Anyone with the link"). The plugin downloads it once, unpacks it into
// LIBRARY_DIR and re-downloads when asked or when the local copy is old.
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { LIBRARY_DIR } from './library.mjs';
import { CONFIG_DIR } from './lib.mjs';

const LINK_FILE = join(CONFIG_DIR, 'library-link.json');

const MAX_BYTES = 300 * 1024 * 1024;
const STALE_DAYS = 14;
const SOURCE_FILE = 'source.json';

const fail = (message) => Object.assign(new Error(message), { expected: true });

/** File ID from a Google Drive share link, or null if it is not one. */
export function parseDriveId(url) {
  let u;
  try {
    u = new URL(String(url).trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || !['drive.google.com', 'drive.usercontent.google.com', 'docs.google.com'].includes(u.hostname)) return null;
  const id = /\/file\/d\/([A-Za-z0-9_-]{20,})/.exec(u.pathname)?.[1] || u.searchParams.get('id');
  return id && /^[A-Za-z0-9_-]{20,}$/.test(id) ? id : null;
}

const isGoogleHost = (h) => /(^|\.)google\.com$|(^|\.)googleusercontent\.com$/.test(h);

/** GET that follows redirects only within Google's hosts. */
async function googleFetch(url, hops = 5) {
  for (let i = 0; i <= hops; i++) {
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(300_000) });
    if (res.status < 300 || res.status >= 400) return res;
    const next = new URL(res.headers.get('location') || '', url);
    if (next.protocol !== 'https:' || !isGoogleHost(next.hostname)) throw fail('Google Drive sent the download somewhere unexpected.');
    url = next;
  }
  throw fail('Too many redirects from Google Drive.');
}

const NOT_SHARED =
  'Google Drive did not hand over the file. Check that it is shared as "Anyone with the link" and that the link is to the library zip.';

/** Download a shared Drive file to dest. Returns the number of bytes written. */
export async function downloadDriveFile(fileId, dest) {
  let res = await googleFetch(new URL(`https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`));
  if ((res.headers.get('content-type') || '').startsWith('text/html')) {
    // Drive's "can't scan this file for viruses" page: resubmit its form once.
    const html = await res.text();
    const action = /<form[^>]+action="([^"]+)"/i.exec(html)?.[1];
    if (!action) throw fail(NOT_SHARED);
    const next = new URL(action.replace(/&amp;/g, '&'), 'https://drive.usercontent.google.com/');
    if (!isGoogleHost(next.hostname)) throw fail(NOT_SHARED);
    for (const m of html.matchAll(/<input[^>]+type="hidden"[^>]*>/gi)) {
      const name = /name="([^"]+)"/.exec(m[0])?.[1];
      const value = /value="([^"]*)"/.exec(m[0])?.[1];
      if (name) next.searchParams.set(name, value || '');
    }
    res = await googleFetch(next);
  }
  if (!res.ok || (res.headers.get('content-type') || '').startsWith('text/html') || !res.body) throw fail(NOT_SHARED);
  if (Number(res.headers.get('content-length') || 0) > MAX_BYTES) throw fail('The library file is larger than 300 MB.');

  mkdirSync(dirname(dest), { recursive: true });
  let bytes = 0;
  const counter = async function* (source) {
    for await (const chunk of source) {
      bytes += chunk.length;
      if (bytes > MAX_BYTES) throw fail('The library file is larger than 300 MB.');
      yield chunk;
    }
  };
  await pipeline(Readable.fromWeb(res.body), counter, createWriteStream(dest));
  return bytes;
}

function listZip(zipPath) {
  const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    return run('unzip', ['-Z1', zipPath]).split('\n').filter(Boolean);
  } catch {
    return run('tar', ['-tf', zipPath]).split('\n').filter(Boolean); // Windows: bsdtar reads zip
  }
}

function extractZip(zipPath, dir) {
  try {
    execFileSync('unzip', ['-q', '-o', zipPath, '-d', dir], { stdio: 'ignore' });
  } catch {
    execFileSync('tar', ['-xf', zipPath, '-C', dir], { stdio: 'ignore' });
  }
}

/**
 * Unpack a library zip and put it in place. The current library is only replaced
 * once the new one has been checked, so a bad download never breaks a working copy.
 * Returns { posts, images, page }.
 */
export function installFromZip(zipPath, source = {}) {
  let entries;
  try {
    entries = listZip(zipPath);
  } catch {
    throw fail('The downloaded file is not a zip archive.');
  }
  for (const e of entries) {
    const p = e.replace(/\\/g, '/');
    if (p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.split('/').includes('..')) throw fail('The library zip contains an unsafe file path.');
    if (p !== 'index.json' && !p.startsWith('images/')) throw fail('The file is not a post library (unexpected contents).');
  }
  if (!entries.includes('index.json')) throw fail('The file is not a post library (no index.json).');

  const parent = dirname(LIBRARY_DIR);
  mkdirSync(parent, { recursive: true });
  const staging = join(parent, `.library-new-${process.pid}`);
  const previous = join(parent, `.library-old-${process.pid}`);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging);
  try {
    extractZip(zipPath, staging);
    const index = JSON.parse(readFileSync(join(staging, 'index.json'), 'utf8'));
    if (!index?.meta || !Array.isArray(index.posts) || !index.posts.length) throw new Error('bad index');
    const images = existsSync(join(staging, 'images')) ? readdirSync(join(staging, 'images')).length : 0;
    writeFileSync(join(staging, SOURCE_FILE), JSON.stringify({ ...source, installed_at: new Date().toISOString() }, null, 2));

    rmSync(previous, { recursive: true, force: true });
    if (existsSync(LIBRARY_DIR)) renameSync(LIBRARY_DIR, previous);
    try {
      renameSync(staging, LIBRARY_DIR);
    } catch (e) {
      if (existsSync(previous)) renameSync(previous, LIBRARY_DIR); // put the old one back
      throw e;
    }
    rmSync(previous, { recursive: true, force: true });
    return { posts: index.posts.length, images, page: index.meta.page || '' };
  } catch (e) {
    rmSync(staging, { recursive: true, force: true });
    if (e.expected) throw e;
    throw fail('The file could not be unpacked as a post library.');
  }
}

/** Where the installed library came from, or null. */
export function librarySource() {
  try {
    return JSON.parse(readFileSync(join(LIBRARY_DIR, SOURCE_FILE), 'utf8'));
  } catch {
    return null;
  }
}

/** The saved library link: what the user entered, whether or not it has been downloaded yet. */
export function getLibraryLink() {
  try {
    const url = JSON.parse(readFileSync(LINK_FILE, 'utf8')).url;
    if (typeof url === 'string') return url;
  } catch {
    // no link file
  }
  return librarySource()?.url || '';
}

function saveLibraryLink(url) {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(LINK_FILE, JSON.stringify({ url }, null, 2) + '\n', { mode: 0o600 });
}

let lastDownload = null; // { state: 'downloading' | 'failed', message? } for the most recent background download

/**
 * Save a new link and download the library in the background (used by the settings page, which must answer at once).
 * An empty link forgets the link; the installed library stays.
 */
export function setLibraryLink(url) {
  const link = String(url || '').trim();
  if (!link) {
    saveLibraryLink('');
    return;
  }
  if (!parseDriveId(link)) throw fail('That is not a Google Drive file link. It should look like https://drive.google.com/file/d/…/view');
  saveLibraryLink(link);
  if (link === librarySource()?.url && libraryInstalled()) return;
  refreshing = true;
  lastDownload = { state: 'downloading' };
  installFromLink(link)
    .then(() => {
      lastDownload = null;
    })
    .catch((e) => {
      lastDownload = { state: 'failed', message: e.expected ? e.message : 'The download failed.' };
    })
    .finally(() => {
      refreshing = false;
    });
}

/** One line for status output. */
export function libraryStatus() {
  if (lastDownload?.state === 'downloading') return 'Post library: downloading now, ready in about a minute.';
  const problem = lastDownload?.state === 'failed' ? ` The last download failed: ${lastDownload.message}` : '';
  let index;
  try {
    index = JSON.parse(readFileSync(join(LIBRARY_DIR, 'index.json'), 'utf8'));
  } catch {
    return `Post library: not installed.${problem}`;
  }
  const src = librarySource();
  const when = src?.installed_at ? `, downloaded ${src.installed_at.slice(0, 10)}` : '';
  return `Post library: ${index.posts.length} posts${index.meta?.page ? ` from ${index.meta.page}` : ''}${when}${src?.url ? '' : ' (copied by hand, no link saved)'}.${problem}`;
}

/** Download from a Drive link (or the saved one) and install. */
export async function installFromLink(url) {
  const link = url || getLibraryLink();
  if (!link) throw fail('No post library link is saved yet. Ask the user for the Google Drive link to the library.');
  const fileId = parseDriveId(link);
  if (!fileId) throw fail('That is not a Google Drive file link. It should look like https://drive.google.com/file/d/…/view');
  const tmp = join(dirname(LIBRARY_DIR), `.library-download-${process.pid}.zip`);
  try {
    const bytes = await downloadDriveFile(fileId, tmp);
    const result = { ...installFromZip(tmp, { url: link, fileId, bytes }), bytes };
    saveLibraryLink(link);
    return result;
  } finally {
    rmSync(tmp, { force: true });
  }
}

let refreshing = false;
/** If the library came from a link and is old, refresh it in the background. Never throws. */
export function refreshIfStale() {
  const src = librarySource();
  if (refreshing || !src?.url || !src.installed_at) return false;
  if (Date.now() - Date.parse(src.installed_at) < STALE_DAYS * 86_400_000) return false;
  refreshing = true;
  installFromLink(src.url)
    .catch(() => {
      // Keep the current copy. Record the attempt so we do not retry on every post.
      try {
        const cur = librarySource();
        if (cur) writeFileSync(join(LIBRARY_DIR, SOURCE_FILE), JSON.stringify({ ...cur, installed_at: new Date().toISOString(), last_refresh_failed: true }, null, 2));
      } catch {
        // nothing more to do
      }
    })
    .finally(() => {
      refreshing = false;
    });
  return true;
}

/** True while a background refresh is running (the server waits for it before exiting). */
export const isRefreshing = () => refreshing;
export const libraryInstalled = () => existsSync(join(LIBRARY_DIR, 'index.json')) && statSync(join(LIBRARY_DIR, 'index.json')).isFile();
