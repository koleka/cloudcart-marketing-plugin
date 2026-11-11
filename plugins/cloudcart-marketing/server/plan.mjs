// Weekly post plan: gather what is worth posting about (new, selling, on sale, not posted
// about lately) from the store and the post library. ChatGPT composes the plan from this.
// Read-only towards the store; plans are saved as local files.
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';
import { loadConfig, getFromStore, buildSearch } from './lib.mjs';
import { loadLibrary } from './library.mjs';

export const PLANS_ROOT = process.env.CLOUDCART_PLANS_DIR || join(homedir(), 'Documents', 'CloudCart Marketing', 'plans');
const DAY = 86_400_000;
const ORDER_PAGES_MAX = 5;
const KINDS = ['product', 'sale', 'multi_product', 'kit', 'education', 'seasonal'];

const err = (message) => Object.assign(new Error(message), { expected: true });

async function api(cfg, path, params) {
  const r = await getFromStore(cfg, path, buildSearch(params).search);
  if (r.status === 401) throw err('The store rejected the API key. Call cloudcart_connect so the user can enter a new one.');
  if (r.status === 429) throw err('The store is asking to slow down. Wait a minute and try again.');
  if (r.status >= 400 || !r.json) throw err(`The store returned an unexpected response (HTTP ${r.status}).`);
  return r.json;
}

const productPath = (u) => {
  try {
    const p = new URL(u).pathname.replace(/\/$/, '');
    return p.includes('/product/') ? p : null;
  } catch {
    return null;
  }
};

/** From the post library: when each product was last posted, the recent mix of post types, and when posts do best. */
function libraryInsights(library) {
  if (!library) return null;
  const posts = library.posts;
  const newest = Date.parse(posts[0].date.replace('+0000', '+00:00'));
  const lastPosted = new Map(); // product path -> { date, count }
  for (const p of posts) {
    for (const l of p.links) {
      const path = productPath(l);
      if (!path) continue;
      const cur = lastPosted.get(path);
      if (!cur) lastPosted.set(path, { date: p.date.slice(0, 10), count: 1 }); // posts are newest first
      else cur.count++;
    }
  }
  const within = (days) => posts.filter((p) => newest - Date.parse(p.date.replace('+0000', '+00:00')) <= days * DAY);
  const mix = {};
  for (const p of within(30)) mix[p.post_type || 'other'] = (mix[p.post_type || 'other'] || 0) + 1;

  const year = within(365).filter((p) => p.pct !== null);
  const avgBy = (keyOf) => {
    const groups = {};
    for (const p of year) (groups[keyOf(p)] ||= []).push(p.pct);
    return Object.entries(groups)
      .filter(([, v]) => v.length >= 5)
      .map(([key, v]) => ({ key, posts: v.length, avg_engagement_percentile: Math.round(v.reduce((a, b) => a + b, 0) / v.length) }))
      .sort((a, b) => b.avg_engagement_percentile - a.avg_engagement_percentile);
  };
  const local = (p) => new Date(p.date.replace('+0000', '+00:00'));
  const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return {
    lastPosted,
    summary: {
      library_newest_post: posts[0].date.slice(0, 10),
      posts_in_last_30_days_by_type: mix,
      engagement_by_post_type_last_year: avgBy((p) => p.post_type || 'other').map(({ key, ...r }) => ({ post_type: key, ...r })),
      best_weekdays_last_year: avgBy((p) => weekdays[local(p).getDay()]).slice(0, 3).map(({ key, ...r }) => ({ weekday: key, ...r })),
      best_hours_last_year: avgBy((p) => String(local(p).getHours()).padStart(2, '0') + ':00').slice(0, 3).map(({ key, ...r }) => ({ local_hour: key, ...r })),
    },
  };
}

/** plan_start: candidates for this week's posts, with the reasons each one is worth posting about. */
export async function planStart(args) {
  const cfg = loadConfig();
  if (!cfg.store || !cfg.apiKey) throw err('The store is not connected yet. Call cloudcart_connect first.');
  const library = loadLibrary();
  const insights = libraryInsights(library);
  const shopUrl = (library?.meta?.shop_url || `https://${cfg.store}`).replace(/\/$/, '');
  const products = new Map(); // id -> candidate
  const candidate = (id) => {
    if (!products.has(id)) products.set(id, { product_id: String(id), signals: {} });
    return products.get(id);
  };

  // 1) What sold in the last 30 days, from order line items.
  const since = new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10);
  let orders = 0;
  let currency = null;
  let pages = 0;
  let sampled = false;
  for (let page = 1; page <= ORDER_PAGES_MAX; page++) {
    const doc = await api(cfg, 'orders', {
      'filter[start_date]': since, include: 'products', 'page[size]': 100, 'page[number]': page, sort: '-date_added',
      'fields[orders]': 'status,abandoned,currency,date_added',
      'fields[order-products]': 'order_id,product_id,quantity,price,name,vendor_name,category_name',
    });
    pages = page;
    const good = new Set();
    for (const o of doc.data || []) {
      if (o.attributes.status === 'cancelled' || String(o.attributes.abandoned) === '1') continue;
      good.add(String(o.id));
      orders++;
      currency ||= o.attributes.currency;
    }
    for (const li of doc.included || []) {
      const a = li.attributes || {};
      if (li.type !== 'order-products' || !a.product_id || !good.has(String(a.order_id))) continue;
      const c = candidate(a.product_id);
      c.name ||= a.name;
      c.brand ||= a.vendor_name;
      c.category ||= a.category_name;
      c.signals.units_sold_30d = (c.signals.units_sold_30d || 0) + (Number(a.quantity) || 0);
      c.signals.revenue_30d = Math.round(((c.signals.revenue_30d || 0) + ((Number(a.price) || 0) * (Number(a.quantity) || 0)) / 100) * 100) / 100;
    }
    const last = doc.meta?.page?.['last-page'] ?? page;
    if (page >= last) break;
    if (page === ORDER_PAGES_MAX) sampled = true;
  }
  // Keep the 12 best sellers by units; the rest of the order lines are noise for planning.
  const sellers = [...products.values()].sort((a, b) => (b.signals.units_sold_30d || 0) - (a.signals.units_sold_30d || 0));
  sellers.forEach((c, i) => {
    if (i < 12) c.signals.best_seller_rank = i + 1;
    else products.delete(Number(c.product_id)) || products.delete(c.product_id);
  });

  // 2) New in the store and 3) on sale, with stock.
  const listFields = { include: 'variants', 'fields[products]': 'name,url_handle,date_added,price_from,price_percent,sale,active,is_hidden,continue_selling', 'fields[variants]': 'item_id,quantity' };
  const fromList = (doc, mark) => {
    const stock = {};
    for (const v of doc.included || []) if (v.type === 'variants') stock[v.attributes.item_id] = (stock[v.attributes.item_id] || 0) + (Number(v.attributes.quantity) || 0);
    for (const p of doc.data || []) {
      const a = p.attributes || {};
      if (String(a.is_hidden) === '1' || a.active !== 'yes' || !(a.price_from > 0) || /^_/.test(a.name || '')) continue;
      const c = candidate(Number(p.id));
      c.name = a.name;
      c.url = `${shopUrl}/product/${a.url_handle}`;
      c.price = a.price_from / 100;
      c.in_stock = (stock[p.id] || 0) > 0 || a.continue_selling === 'yes';
      mark(c, a);
    }
  };
  const [newest, onSale] = await Promise.all([
    api(cfg, 'products', { ...listFields, sort: '-date_added', 'filter[active]': 'yes', 'page[size]': 15 }),
    api(cfg, 'products', { ...listFields, 'filter[sale]': 'yes', 'filter[active]': 'yes', 'page[size]': 30 }),
  ]);
  fromList(newest, (c, a) => {
    if (Date.now() - Date.parse(a.date_added) <= 45 * DAY) c.signals.new_since = a.date_added.slice(0, 10);
  });
  fromList(onSale, (c, a) => {
    c.signals.on_sale = a.price_percent ? { percent_off: a.price_percent / 100 } : true;
  });

  // Best sellers come from order lines: fetch their page link, price and stock.
  const missing = [...products.values()].filter((c) => !c.url);
  await Promise.all(
    missing.map(async (c) => {
      try {
        const doc = await api(cfg, `products/${c.product_id}`, listFields);
        fromList({ data: [doc.data], included: doc.included }, () => {});
      } catch {
        // leave it without a link; it is dropped below
      }
    }),
  );

  const candidates = [...products.values()]
    .filter((c) => c.url && Object.keys(c.signals).length)
    .map((c) => {
      const posted = insights?.lastPosted.get(productPath(c.url));
      c.signals.last_posted = posted?.date || null;
      c.signals.posts_about_it = posted?.count || 0;
      return c;
    })
    .sort((a, b) => Object.keys(b.signals).length - Object.keys(a.signals).length);

  return {
    today: new Date().toISOString().slice(0, 10),
    weekday_today: new Date().toLocaleDateString('en-US', { weekday: 'long' }),
    posts_wanted: Math.min(Math.max(parseInt(args?.posts, 10) || 5, 1), 10),
    currency,
    sales_window: { from: since, orders_counted: orders, note: sampled ? `Only the latest ${pages * 100} orders were read, so best sellers are from a sample.` : undefined },
    candidates,
    page: library ? { name: library.meta.page, about: library.meta.about, ...insights.summary } : null,
    library_note: library ? undefined : 'No post library is installed, so there is no posting history: last_posted is unknown for every product.',
    kinds_you_can_plan: KINDS,
  };
}

/** plan_save: store the plan ChatGPT composed. Returns its file path. */
export function planSave(args) {
  const items = Array.isArray(args?.items) ? args.items : [];
  if (!items.length) throw err('"items" must list at least one planned post.');
  const clean = items.slice(0, 14).map((it, i) => {
    if (!it || typeof it.title !== 'string' || !it.title.trim()) throw err(`Item ${i + 1} needs a "title".`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(it.day || '')) throw err(`Item ${i + 1} needs "day" as YYYY-MM-DD.`);
    const kind = KINDS.includes(it.kind) ? it.kind : 'product';
    let url = null;
    if (typeof it.product_url === 'string' && it.product_url) {
      try {
        const u = new URL(it.product_url);
        if (u.protocol === 'https:') url = u.href;
      } catch {
        // ignore a malformed link
      }
    }
    return {
      day: it.day, time: /^\d{2}:\d{2}$/.test(it.time || '') ? it.time : null, kind, title: it.title.trim().slice(0, 200),
      product_name: typeof it.product_name === 'string' ? it.product_name.slice(0, 200) : null, product_url: url,
      reason: typeof it.reason === 'string' ? it.reason.slice(0, 400) : '',
    };
  });
  clean.sort((a, b) => (a.day + (a.time || '')).localeCompare(b.day + (b.time || '')));
  mkdirSync(PLANS_ROOT, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const file = join(PLANS_ROOT, `${stamp}.json`);
  writeFileSync(file, JSON.stringify({ created_at: new Date().toISOString(), note: typeof args.note === 'string' ? args.note.slice(0, 600) : '', items: clean }, null, 2));
  return { plan: file, items: clean.length };
}

/** plan_show: the saved plan (latest by default) for the plan card. */
export function planShow(args) {
  let file = args?.plan;
  if (file) {
    let real, root;
    try {
      real = realpathSync(file);
      root = realpathSync(PLANS_ROOT);
    } catch {
      throw err('That plan file was not found.');
    }
    if (!real.startsWith(root + sep) || !real.endsWith('.json')) throw err('That is not a plan saved by plan_save.');
    file = real;
  } else {
    const all = existsSync(PLANS_ROOT) ? readdirSync(PLANS_ROOT).filter((f) => /^\d{8}-\d{6}\.json$/.test(f)).sort() : [];
    if (!all.length) throw err('No plan has been saved yet. Call plan_start, compose the plan, then plan_save.');
    file = join(PLANS_ROOT, all[all.length - 1]);
  }
  const plan = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(plan?.items)) throw err('That is not a plan saved by plan_save.');
  const library = loadLibrary();
  return {
    summary:
      `Showing the plan card with ${plan.items.length} post(s): ` +
      plan.items.map((i) => `${i.day} ${i.title}`).join('; ') +
      '. If no card appears in this app, show the plan as a short list instead.',
    structuredContent: { page: { name: library?.meta?.page || '' }, file, created_at: plan.created_at, note: plan.note, items: plan.items },
  };
}
