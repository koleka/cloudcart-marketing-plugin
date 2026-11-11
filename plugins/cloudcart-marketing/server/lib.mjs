// Shared helpers for the CloudCart store MCP server and its setup script.
// Uses the CloudCart REST JSON:API (/api/v2). GET requests only.
// No dependencies: needs Node.js 18+ (built-in fetch).
import { readFileSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const CONFIG_DIR = join(homedir(), '.config', 'cloudcart-marketing');
export const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

// Every resource the REST docs list a GET endpoint for. Anything else is refused.
export const RESOURCES = [
  'authors', 'blogs', 'categories', 'customer-billing-address', 'customer-groups',
  'customer-shipping-address', 'customer-tags', 'customers', 'discount-codes',
  'discount-codes-pro', 'discounts', 'images', 'order-billing-address', 'order-discount',
  'order-fulfillment', 'order-payment', 'order-products', 'order-products-options',
  'order-returns', 'order-shipping', 'order-shipping-address', 'order-status', 'order-tax',
  'order-total', 'orders', 'payment-providers', 'posts', 'product-options',
  'product-to-discount', 'products', 'properties', 'property-options', 'redirects',
  'segments', 'shipping-providers', 'store-quantity', 'stores', 'subscribers',
  'subscribers-channels', 'subscribers-tags', 'tags', 'units', 'variant-options',
  'variant-parameters', 'variants', 'vendors',
];

const HOST_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

/** Turn "https://MyStore.cloudcart.com/admin/" into "mystore.cloudcart.com". Returns null if invalid. */
export function normalizeStore(input) {
  if (typeof input !== 'string') return null;
  const host = input.trim().toLowerCase().replace(/^https?:\/\//, '').split(/[/?#]/)[0];
  return HOST_RE.test(host) ? host : null;
}

/** Environment variables win over the config file. */
export function loadConfig() {
  let file = {};
  try {
    file = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    // no config file yet
  }
  const store = normalizeStore(process.env.CLOUDCART_STORE || file.store || '');
  const apiKey = String(process.env.CLOUDCART_API_KEY || file.apiKey || '').trim();
  return { store, apiKey };
}

/** Save the connection details, readable only by the current user. */
export function saveConfig({ store, apiKey }) {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG_PATH, JSON.stringify({ store, apiKey }, null, 2) + '\n', { mode: 0o600 });
  chmodSync(CONFIG_PATH, 0o600);
}

/**
 * Check a store address and API key by reading one product.
 * Returns { ok: true, store, productCount } or { ok: false, reason } where reason is
 * "bad_store" | "bad_key" | "bad_response" | "unreachable".
 */
export async function checkConnection(storeInput, apiKey) {
  const store = normalizeStore(storeInput);
  if (!store) return { ok: false, reason: 'bad_store' };
  if (typeof apiKey !== 'string' || !apiKey.trim()) return { ok: false, reason: 'bad_key' };
  try {
    const r = await getFromStore({ store, apiKey: apiKey.trim() }, 'products', '?page%5Bsize%5D=1', 15000);
    if (r.status === 401 || r.status === 403) return { ok: false, reason: 'bad_key' };
    if (r.status >= 400 || !r.json) return { ok: false, reason: 'bad_response' };
    return { ok: true, store, productCount: r.json?.meta?.page?.total ?? r.json?.meta?.total_count };
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
}

/**
 * Validate "orders" or "orders/5012" (a leading "/" or "/api/v2/" is tolerated).
 * Returns { path } or { error }.
 */
export function parsePath(input) {
  if (typeof input !== 'string') return { error: '"path" must be a string such as "orders" or "orders/5012".' };
  const path = input.trim().replace(/^\/?(api\/v2\/)?/, '').replace(/\/$/, '');
  const m = /^([a-z-]+)(?:\/([A-Za-z0-9_-]+))?$/.exec(path);
  if (!m) return { error: `"${input}" is not a valid path. Use "resource" or "resource/id", and put filters in "params".` };
  if (!RESOURCES.includes(m[1]))
    return { error: `Unknown resource "${m[1]}". Available: ${RESOURCES.join(', ')}.` };
  return { path };
}

/** Build a query string from a flat object like { "page[size]": 50, sort: "-date_added" }. Returns { search } or { error }. */
export function buildSearch(params) {
  if (params === undefined || params === null) return { search: '' };
  if (typeof params !== 'object' || Array.isArray(params)) return { error: '"params" must be an object.' };
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (!/^[A-Za-z0-9_.-]+(\[[A-Za-z0-9_.-]*\])*$/.test(k))
      return { error: `Invalid parameter name "${k}". Examples: "page[size]", "filter[active]", "include", "sort".` };
    if (!['string', 'number', 'boolean'].includes(typeof v))
      return { error: `Parameter "${k}" must be a string or number.` };
    sp.append(k, String(v));
  }
  const s = sp.toString();
  return { search: s ? `?${s}` : '' };
}

/** GET a path under /api/v2 on the store. This is the only HTTP call the plugin makes. */
export async function getFromStore({ store, apiKey }, path, search = '', timeoutMs = 30000) {
  const res = await fetch(`https://${store}/api/v2/${path}${search}`, {
    method: 'GET',
    headers: {
      'X-CloudCart-ApiKey': apiKey,
      Accept: 'application/vnd.api+json',
    },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'error', // never forward the key to another host
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // non-JSON response (e.g. an HTML error page)
  }
  return {
    status: res.status,
    json,
    rateLimitRemaining: res.headers.get('x-ratelimit-remaining'),
  };
}
