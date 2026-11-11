#!/usr/bin/env node
// Build the "post library" the plugin uses as examples and style references:
// a compact index of a Facebook page's past posts (caption, engagement, analysis)
// plus a small set of recent post images per image template.
//
// Input: a folder produced by the culy-posts project
//   fb_export_output/posts.json, fb_export_output/images/, enrichment/*.json
// Output (default ~/.config/cloudcart-marketing/library):
//   index.json, images/
//
// Usage:
//   node tools/build-post-library.mjs <source-folder> [--out <folder>] [--page "Name"]
//        [--about "what the shop sells"] [--shop-url https://shop.example.com]
//
// The library is the shop's own data. It is not part of this repository.
import { readFileSync, readdirSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, basename, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args.splice(i, 2)[1] : fallback;
};
const out = resolve(opt('out', join(homedir(), '.config', 'cloudcart-marketing', 'library')));
const page = opt('page', '');
const about = opt('about', '');
let shopUrl = opt('shop-url', '');
const src = args[0] && resolve(args[0]);
if (!src || !existsSync(join(src, 'fb_export_output', 'posts.json'))) {
  console.error('Usage: node tools/build-post-library.mjs <culy-posts folder> [--out dir] [--page name] [--about text] [--shop-url url]');
  process.exit(1);
}

// How many images to ship per template. The two formats used for product ads today get more.
const CURRENT_AD_TEMPLATES = ['ai_product_ad_infographic', 'ai_model_product_ad'];
const PER_TEMPLATE = (t) => (CURRENT_AD_TEMPLATES.includes(t) ? 16 : 4);

const exportDir = join(src, 'fb_export_output');
const posts = new Map(JSON.parse(readFileSync(join(exportDir, 'posts.json'), 'utf8')).map((p) => [p.id, p]));

// Template and product-type vocabularies come from the source project when its Python env is there.
let templates = {};
let productTypes = [];
try {
  const py = join(src, '.venv', 'bin', 'python');
  const json = execFileSync(
    py,
    ['-c', 'import json; from culy_posts.enrich import TEMPLATES, PRODUCT_TYPES; print(json.dumps({"t": TEMPLATES, "p": PRODUCT_TYPES}))'],
    { cwd: src, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  );
  ({ t: templates, p: productTypes } = JSON.parse(json));
} catch {
  console.warn('Could not read TEMPLATES from the source project; using the codes found in the data.');
}

const records = [];
for (const name of readdirSync(join(src, 'enrichment'))) {
  if (!name.endsWith('.json')) continue;
  const e = JSON.parse(readFileSync(join(src, 'enrichment', name), 'utf8'));
  const p = posts.get(e.post_id);
  if (!p || !p.message) continue;
  records.push({
    id: p.id,
    date: p.created_time,
    message: p.message,
    permalink: p.permalink_url || null,
    pct: p.engagement_pct_year ?? null,
    links: p.links || [],
    post_type: e.post_type || null,
    product_types: e.product_types || [],
    featured_products: e.featured_products || [],
    featured_brands: e.featured_brands || [],
    why_it_works: e.why_it_works || null,
    images: (e.images || []).slice(0, 2).map((img) => ({
      template: img.template || 'other',
      scene_description: img.scene_description || null,
      layout: img.layout || null,
      background: img.background || null,
      text_blocks: (img.text_blocks || []).map((b) => ({
        role: b.role, text: b.text, position: b.position, size: b.relative_size, color: b.color,
      })),
      product: img.product || null,
      people: img.people ? { count: img.people.count, kind: img.people.kind } : null,
      _src: img.file || null,
    })),
  });
}
records.sort((a, b) => (a.date < b.date ? 1 : -1)); // newest first

// Pick the images to ship: per template, the newest posts whose first matching image exists on disk.
rmSync(join(out, 'images'), { recursive: true, force: true });
mkdirSync(join(out, 'images'), { recursive: true });
const shipped = {};
let bytes = 0;
for (const r of records) {
  for (const img of r.images) {
    const file = img._src && join(exportDir, img._src);
    delete img._src;
    if (!file || !existsSync(file)) continue;
    const n = shipped[img.template] || 0;
    if (n >= PER_TEMPLATE(img.template)) continue;
    const name = basename(file);
    copyFileSync(file, join(out, 'images', name));
    bytes += statSync(file).size;
    img.file = `images/${name}`;
    shipped[img.template] = n + 1;
  }
}

for (const r of records) for (const img of r.images) if (!(img.template in templates)) templates[img.template] = '';
if (!productTypes.length) productTypes = [...new Set(records.flatMap((r) => r.product_types))].sort();

if (!shopUrl) {
  const hosts = {};
  for (const r of records) for (const l of r.links) {
    try { const h = new URL(l).origin; hosts[h] = (hosts[h] || 0) + 1; } catch { /* not a URL */ }
  }
  shopUrl = Object.entries(hosts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}

const index = {
  meta: {
    page, about, shop_url: shopUrl,
    built_at: new Date().toISOString(),
    newest_post: records[0]?.date || null,
    posts: records.length,
    current_ad_templates: CURRENT_AD_TEMPLATES,
    templates, product_types: productTypes,
  },
  posts: records,
};
writeFileSync(join(out, 'index.json'), JSON.stringify(index));

const mb = (n) => (n / 1e6).toFixed(1) + ' MB';
console.log(`Library written to ${out}`);
console.log(`  ${records.length} posts, index ${mb(statSync(join(out, 'index.json')).size)}`);
console.log(`  ${Object.values(shipped).reduce((a, b) => a + b, 0)} images, ${mb(bytes)}`);
console.log(`  shop: ${shopUrl || '(unknown)'}  page: ${page || '(not set)'}`);
