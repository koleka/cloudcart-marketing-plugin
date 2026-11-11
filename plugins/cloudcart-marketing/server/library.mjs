// The post library: the page's own past posts, used as examples and style references.
// Built by tools/build-post-library.mjs into ~/.config/cloudcart-marketing/library.
// Ranking follows the culy-posts project: what is about a similar product, what performed
// well, how the page posts today. Past posts are guidance; the goal is to do better.
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_DIR } from './lib.mjs';

export const LIBRARY_DIR = process.env.CLOUDCART_LIBRARY_DIR || join(CONFIG_DIR, 'library');

const PRODUCT_POST_TYPES = new Set(['product_promo', 'multi_product_promo', 'kit_promo', 'testimonial']);
const W_SIMILARITY = 0.35;
const W_PERFORMANCE = 0.3;
const W_RECENCY = 0.15;
const BONUS_SAME_TYPE = 0.2;
const BONUS_SAME_PRODUCT = 0.3;
const RECENCY_HALF_LIFE_DAYS = 365;
const STYLE_REF_WINDOW_DAYS = 180;
const DAY = 86_400_000;

let cache = null; // { mtimeMs, index }

/** Returns the library index, or null when no library is installed. */
export function loadLibrary() {
  const file = join(LIBRARY_DIR, 'index.json');
  let mtimeMs;
  try {
    mtimeMs = statSync(file).mtimeMs;
  } catch {
    return null;
  }
  if (!cache || cache.mtimeMs !== mtimeMs) cache = { mtimeMs, index: JSON.parse(readFileSync(file, 'utf8')) };
  return cache.index;
}

const time = (post) => Date.parse(post.date.replace('+0000', '+00:00'));
const urlPath = (u) => {
  try {
    return new URL(u).pathname.replace(/\/$/, '');
  } catch {
    return null;
  }
};
const isSameProduct = (post, productPath) => !!productPath && post.links.some((l) => urlPath(l) === productPath);
const tokens = (s) => new Set(String(s || '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []);

/**
 * Score every product-related post for this product, best first.
 * product: { url, name, brand }, productTypes: string[]
 */
export function rank(index, product, productTypes) {
  const types = new Set(productTypes);
  const productPath = urlPath(product.url);
  const candidates = index.posts.filter(
    (p) => PRODUCT_POST_TYPES.has(p.post_type) || p.product_types.some((t) => types.has(t)),
  );
  if (!candidates.length) return [];
  const newest = time(index.posts[0]);
  // Similarity without an embedding index: how many words of the product name and brand the post mentions.
  const want = tokens(`${product.name} ${product.brand || ''}`);
  const sims = candidates.map((p) => {
    if (!want.size) return 0;
    const have = tokens(`${p.featured_products.join(' ')} ${p.featured_brands.join(' ')} ${p.message.slice(0, 400)}`);
    let hit = 0;
    for (const t of want) if (have.has(t)) hit++;
    return hit / want.size;
  });

  return candidates
    .map((post, i) => {
      const same = isSameProduct(post, productPath);
      const shared = post.product_types.filter((t) => types.has(t)).sort();
      const pct = post.pct || 0;
      const ageDays = (newest - time(post)) / DAY;
      const score =
        W_SIMILARITY * sims[i] +
        (W_PERFORMANCE * pct) / 100 +
        W_RECENCY * 0.5 ** (ageDays / RECENCY_HALF_LIFE_DAYS) +
        (shared.length ? BONUS_SAME_TYPE : 0) +
        (same ? BONUS_SAME_PRODUCT : 0);
      const match = [same ? 'same product' : '', shared.join('/'), `name match ${sims[i].toFixed(2)}`, `pct ${pct}`, post.date.slice(0, 7)]
        .filter(Boolean)
        .join(' · ');
      return { post, score, match, same, shared };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Best-scoring posts as guidance: at most maxSameProduct about this exact product, plus the best
 * nRecent same-type posts from the last recentDays days for today's voice. Reposts count once.
 */
export function selectExamples(ranked, n = 4, nRecent = 2, maxSameProduct = 2, recentDays = 120) {
  const picked = [];
  const seenIds = new Set();
  const seenCaptions = new Set();
  const take = (ex, label = '') => {
    const key = ex.post.message.slice(0, 200).replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase();
    if (!key || seenIds.has(ex.post.id) || seenCaptions.has(key)) return false;
    seenIds.add(ex.post.id);
    seenCaptions.add(key);
    picked.push({ ...ex, match: label + ex.match });
    return true;
  };
  let sameCount = 0;
  for (const ex of ranked) {
    if (picked.length >= n) break;
    if (ex.same && sameCount >= maxSameProduct) continue;
    if (take(ex) && ex.same) sameCount++;
  }
  if (ranked.length) {
    const newest = Math.max(...ranked.map((ex) => time(ex.post)));
    let recent = ranked.filter((ex) => (newest - time(ex.post)) / DAY <= recentDays);
    const typed = recent.filter((ex) => ex.shared.length);
    if (typed.length) recent = typed;
    let added = 0;
    for (const ex of recent) {
      if (added >= nRecent) break;
      if (take(ex, 'recent · ')) added++;
    }
  }
  return picked;
}

/** The current ad template used most for product posts in the last `days` days. */
export function pickTemplate(index, days = 120) {
  const current = index.meta.current_ad_templates || [];
  if (!current.length) return 'other';
  if (!index.posts.length) return current[0];
  const cutoff = time(index.posts[0]) - days * DAY;
  const counts = Object.fromEntries(current.map((t) => [t, 0]));
  for (const p of index.posts) {
    if (time(p) < cutoff || !PRODUCT_POST_TYPES.has(p.post_type)) continue;
    for (const img of p.images) if (img.template in counts) counts[img.template]++;
  }
  return current.reduce((best, t) => (counts[t] > counts[best] ? t : best), current[0]);
}

/**
 * Image files in this template, recent and best-scoring first. Posts about this exact product
 * are skipped so the image generator does not just redraw an old post. Returns absolute paths.
 */
export function selectStyleRefs(index, ranked, template, product, n = 2) {
  const productPath = urlPath(product.url);
  const newest = index.posts.length ? time(index.posts[0]) : Date.now();
  const scores = new Map(ranked.map((ex) => [ex.post.id, ex.score]));
  const recent = [];
  const older = [];
  for (const post of index.posts) {
    if (isSameProduct(post, productPath)) continue;
    const img = post.images.find((i) => i.template === template && i.file && existsSync(join(LIBRARY_DIR, i.file)));
    if (!img) continue;
    const row = { score: scores.get(post.id) || 0, file: join(LIBRARY_DIR, img.file), post };
    ((newest - time(post)) / DAY <= STYLE_REF_WINDOW_DAYS ? recent : older).push(row);
  }
  recent.sort((a, b) => b.score - a.score);
  older.sort((a, b) => b.score - a.score);
  return [...recent, ...older].slice(0, n);
}

/** Engagement by image template for posts about the same product type, plus the best of them. */
export function performanceInsights(ranked, productTypes) {
  const typed = ranked.filter((ex) => ex.shared.length);
  const relevant = typed.length ? typed : ranked;
  const byTemplate = {};
  for (const { post } of relevant) {
    if (post.images.length && post.pct !== null) (byTemplate[post.images[0].template] ||= []).push(post.pct);
  }
  const by_template = Object.entries(byTemplate)
    .map(([template, v]) => ({ template, posts: v.length, avg_engagement_percentile: Math.round(v.reduce((a, b) => a + b, 0) / v.length) }))
    .sort((a, b) => b.avg_engagement_percentile - a.avg_engagement_percentile);
  const best_posts = [...relevant]
    .sort((a, b) => (b.post.pct || 0) - (a.post.pct || 0))
    .slice(0, 8)
    .map(({ post }) => ({
      date: post.date.slice(0, 10),
      engagement_percentile: post.pct,
      template: post.images[0]?.template || null,
      post_type: post.post_type,
      first_line: post.message.split('\n')[0].slice(0, 140),
    }));
  return { scope: productTypes.join('/') || 'product', posts_considered: relevant.length, by_template, best_posts };
}

/** What the writer sees of one example. */
export function exampleForWriter(ex) {
  return {
    why_picked: ex.match,
    date: ex.post.date.slice(0, 10),
    engagement_percentile: ex.post.pct,
    caption: ex.post.message,
    why_it_worked_or_not: ex.post.why_it_works,
    images: ex.post.images.map(({ file, ...analysis }) => analysis),
    permalink: ex.post.permalink,
  };
}

// --- Posts that are not about one product -------------------------------------------------

/** Which of the page's post types serve as examples for each kind of post. */
export const KIND_POST_TYPES = {
  multi_product: ['multi_product_promo', 'kit_promo'],
  kit: ['kit_promo', 'multi_product_promo'],
  education: ['education'],
  seasonal: ['seasonal_holiday'],
};

/**
 * Rank the page's posts of the matching type for a kit, multi-product, educational or seasonal post.
 * subject: { kind, topic, occasion, products: [{ url, name, brand }] }
 */
export function rankForKind(index, subject) {
  const wanted = new Set(KIND_POST_TYPES[subject.kind] || []);
  const candidates = index.posts.filter((p) => wanted.has(p.post_type));
  if (!candidates.length) return [];
  const newest = time(index.posts[0]);
  const paths = new Set((subject.products || []).map((pr) => urlPath(pr.url)).filter(Boolean));
  const want = tokens(`${subject.topic || ''} ${(subject.products || []).map((pr) => `${pr.name} ${pr.brand || ''}`).join(' ')}`);
  const primary = (KIND_POST_TYPES[subject.kind] || [])[0];

  return candidates
    .map((post) => {
      let sim = 0;
      if (want.size) {
        const have = tokens(`${post.topic || ''} ${post.featured_products.join(' ')} ${post.featured_brands.join(' ')} ${post.message.slice(0, 400)}`);
        let hit = 0;
        for (const t of want) if (have.has(t)) hit++;
        sim = hit / want.size;
      }
      const same = post.links.some((l) => paths.has(urlPath(l)));
      const sameOccasion = !!subject.occasion && subject.occasion !== 'none' && post.occasion === subject.occasion;
      const pct = post.pct || 0;
      const ageDays = (newest - time(post)) / DAY;
      const score =
        W_SIMILARITY * sim +
        (W_PERFORMANCE * pct) / 100 +
        W_RECENCY * 0.5 ** (ageDays / RECENCY_HALF_LIFE_DAYS) +
        (post.post_type === primary ? 0.1 : 0) +
        (sameOccasion ? BONUS_SAME_TYPE : 0) +
        (same ? BONUS_SAME_PRODUCT : 0);
      const match = [same ? 'same product' : '', sameOccasion ? `occasion ${post.occasion}` : '', post.post_type, `topic match ${sim.toFixed(2)}`, `pct ${pct}`, post.date.slice(0, 7)]
        .filter(Boolean)
        .join(' · ');
      // "shared" marks the closest examples, as product types do for single-product posts.
      return { post, score, match, same, shared: post.post_type === primary ? [post.post_type] : [] };
    })
    .sort((a, b) => b.score - a.score);
}

/** The image template used most among the best-matching posts of this kind, favouring templates that have reference images. */
export function pickTemplateForKind(index, ranked, top = 30) {
  const counts = {};
  for (const { post } of ranked.slice(0, top)) {
    const img = post.images[0];
    if (img?.template && img.template !== 'other') counts[img.template] = (counts[img.template] || 0) + (img.file ? 1 : 0.25);
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'other';
}
