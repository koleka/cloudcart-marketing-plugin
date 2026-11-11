// Facebook post workflow: product -> working folder with the product photo, style reference
// images and example posts -> saved briefs and images. Adapted from the culy-posts project.
// Everything here is local file work plus read-only GETs to the store.
import { mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync, readdirSync, statSync, realpathSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, extname, basename, sep } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { loadConfig, getFromStore } from './lib.mjs';
import { refreshIfStale } from './library-sync.mjs';
import { offerFromVariants, checkPrices } from './offers.mjs';
import { rankForKind, pickTemplateForKind } from './library.mjs';
import { loadLibrary, rank, selectExamples, pickTemplate, selectStyleRefs, performanceInsights, exampleForWriter } from './library.mjs';

export const POSTS_ROOT = process.env.CLOUDCART_POSTS_DIR || join(homedir(), 'Documents', 'CloudCart Marketing', 'posts');
const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const VARIANT_RE = /^(baseline|idea_[1-9])$/;

const err = (message) => Object.assign(new Error(message), { expected: true });

function htmlToText(htmlText) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return String(htmlText || '')
    .replace(/<(br|\/p|\/li|\/h\d|\/div|\/tr)[^>]*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => entities[n.toLowerCase()] ?? m)
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/** Folder must be an existing run folder directly under POSTS_ROOT. Returns its real path. */
function checkRunFolder(folder) {
  if (typeof folder !== 'string' || !folder) throw err('"folder" is required: the folder returned by post_start.');
  let real, root;
  try {
    real = realpathSync(folder);
    root = realpathSync(POSTS_ROOT);
  } catch {
    throw err(`Folder not found: ${folder}. Use the folder returned by post_start.`);
  }
  if (!real.startsWith(root + sep) || real.slice(root.length + 1).includes(sep) || !existsSync(join(real, 'product.json')))
    throw err('That is not a post folder created by post_start.');
  return real;
}

async function apiGet(cfg, path, search = '') {
  const r = await getFromStore(cfg, path, search);
  if (r.status === 401) throw err('The store rejected the API key. Call cloudcart_connect so the user can enter a new one.');
  if (r.status === 404) return null;
  if (r.status >= 400 || !r.json) throw err(`The store returned an unexpected response (HTTP ${r.status}).`);
  return r.json;
}

async function downloadImage(url, destNoExt) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  // A plain public download: the store's API key is never sent here.
  const res = await fetch(u, { signal: AbortSignal.timeout(60_000), redirect: 'follow' });
  const type = (res.headers.get('content-type') || '').split(';')[0].trim();
  if (!res.ok || !type.startsWith('image/')) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length || buf.length > MAX_IMAGE_BYTES) return null;
  const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[type] || extname(u.pathname) || '.jpg';
  const dest = destNoExt + ext;
  writeFileSync(dest, buf);
  return dest;
}

function copyStyleRefs(refs, variantDir) {
  return refs.map((ref, i) => {
    const dest = join(variantDir, `style_ref_${i + 1}${extname(ref.file)}`);
    copyFileSync(ref.file, dest);
    return dest;
  });
}

const KINDS = ['product', 'multi_product', 'kit', 'education', 'seasonal'];

/** Read one product by its page link or ID. Returns { product, imageUrls }. */
async function loadProduct(cfg, ref, shopUrl) {
  let doc;
  let handle = null;
  let productUrl = null;
  if (ref.url) {
    let u;
    try {
      u = new URL(String(ref.url).trim());
    } catch {
      throw err(`"${ref.url}" is not a valid link.`);
    }
    handle = decodeURIComponent(u.pathname.replace(/\/$/, '').split('/').pop() || '');
    if (!/^[\p{L}\p{N}_-]+$/u.test(handle)) throw err(`"${ref.url}" does not look like a product page.`);
    productUrl = `${u.origin}${u.pathname.replace(/\/$/, '')}`;
    doc = await apiGet(cfg, 'products', `?${new URLSearchParams({ 'filter[url_handle]': handle, include: 'images,variants', 'append[variants]': 'discount' })}`);
  } else if (ref.id !== undefined && /^[A-Za-z0-9_-]+$/.test(String(ref.id))) {
    doc = await apiGet(cfg, `products/${ref.id}`, `?${new URLSearchParams({ include: 'images,variants', 'append[variants]': 'discount' })}`);
  } else {
    throw err('Give the product page link or a product ID.');
  }
  const data = Array.isArray(doc?.data) ? doc.data[0] : doc?.data;
  if (!data) throw err(`No product was found in the store for ${ref.url || ref.id}. Check the link.`);
  const a = data.attributes || {};
  handle = a.url_handle || handle || String(data.id);
  if (!productUrl && shopUrl) productUrl = `${shopUrl.replace(/\/$/, '')}/product/${handle}`;

  // Brand and category are separate records; a failure here is not fatal.
  const related = async (rel, resource) => {
    const id = data.relationships?.[rel]?.data?.id ?? a[`${rel}_id`];
    if (!id) return null;
    try {
      return (await apiGet(cfg, `${resource}/${id}`))?.data?.attributes?.name || null;
    } catch {
      return null;
    }
  };
  const [brand, category] = await Promise.all([related('vendor', 'vendors'), related('category', 'categories')]);
  const variants = (doc.included || []).filter((r) => r.type === 'variants');
  const imageUrls = (doc.included || [])
    .filter((r) => r.type === 'images' && r.attributes?.src)
    .sort((x, y) => (x.attributes.sort_order ?? 0) - (y.attributes.sort_order ?? 0))
    .slice(0, 3)
    .map((r) => r.attributes.src);
  return {
    handle,
    imageUrls,
    product: {
      id: String(data.id),
      url: productUrl,
      name: a.name || '',
      brand,
      category,
      price_from: typeof a.price_from === 'number' ? a.price_from / 100 : null,
      price_to: typeof a.price_to === 'number' ? a.price_to / 100 : null,
      active: a.active ?? null,
      in_stock: variants.reduce((n, v) => n + (Number(v.attributes?.quantity) || 0), 0) > 0 || a.continue_selling === 'yes',
      offer: offerFromVariants(variants),
      description: htmlToText(a.description),
    },
  };
}

/**
 * post_start: read the product(s), create the working folder, fetch the photos, pick examples and style references.
 * kind: product (default) | multi_product | kit | education | seasonal.
 */
export async function postStart(args) {
  const cfg = loadConfig();
  if (!cfg.store || !cfg.apiKey) throw err('The store is not connected yet. Call cloudcart_connect first.');
  const kind = KINDS.includes(args?.kind) ? args.kind : 'product';
  const productTypes = Array.isArray(args?.product_types) ? args.product_types.filter((t) => typeof t === 'string') : [];
  const topic = typeof args?.topic === 'string' ? args.topic.trim().slice(0, 300) : '';
  const occasion = typeof args?.occasion === 'string' ? args.occasion.trim().slice(0, 40) : '';
  const library = loadLibrary();
  const shopUrl = library?.meta?.shop_url || `https://${cfg.store}`;

  // Which products this post is about.
  const refs = [];
  if (Array.isArray(args?.product_urls)) for (const u of args.product_urls) if (typeof u === 'string' && u.trim()) refs.push({ url: u });
  if (typeof args?.product_url === 'string' && args.product_url.trim()) refs.unshift({ url: args.product_url });
  if (!refs.length && args?.product_id !== undefined) refs.push({ id: args.product_id });
  const seen = new Set();
  const unique = refs.filter((r) => !seen.has(r.url || `#${r.id}`) && seen.add(r.url || `#${r.id}`));
  if (kind === 'product' && unique.length !== 1) throw err('Give "product_url" (the product page link) or "product_id".');
  if (kind === 'multi_product' && (unique.length < 2 || unique.length > 4)) throw err('A post about several products needs 2 to 4 links in "product_urls".');
  if (kind === 'kit' && (unique.length < 1 || unique.length > 4)) throw err('A kit post needs the kit\'s product link (or up to 4 product links) in "product_urls".');
  if ((kind === 'education' || kind === 'seasonal') && !topic && !occasion) throw err('Give a "topic" (what the post is about) or an "occasion".');
  if ((kind === 'education' || kind === 'seasonal') && unique.length > 1) throw err('An educational or seasonal post takes at most one product.');

  const loaded = await Promise.all(unique.map((r) => loadProduct(cfg, r, shopUrl)));
  const products = loaded.map((l) => l.product);

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const slug = (loaded[0]?.handle || (topic || occasion).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || kind).slice(0, 60);
  const folder = join(POSTS_ROOT, `${stamp}-${slug}`);
  mkdirSync(join(folder, 'baseline'), { recursive: true });

  // Product photos: product.jpg for one product, product_1.jpg … for several.
  const photos = [];
  for (let i = 0; i < loaded.length; i++) {
    let photo = null;
    for (const src of loaded[i].imageUrls) {
      try {
        photo = await downloadImage(src, join(folder, loaded.length === 1 ? 'product' : `product_${i + 1}`));
      } catch {
        photo = null;
      }
      if (photo) break;
    }
    if (photo) photos.push(photo);
  }

  // product.json keeps the single-product fields at the top level so older folders and newer ones read the same.
  writeFileSync(
    join(folder, 'product.json'),
    JSON.stringify({ ...(products[0] || { name: topic || occasion, url: null }), photo: photos[0] ? basename(photos[0]) : null, product_types: productTypes, kind, topic, occasion, products, photos: photos.map((f) => basename(f)) }, null, 2),
  );

  const result = { folder, kind };
  if (kind === 'product') {
    result.product = products[0];
    result.product_photo = photos[0] || null;
  } else {
    if (topic) result.topic = topic;
    if (occasion) result.occasion = occasion;
    result.products = products;
    result.product_photos = photos;
  }
  const soldOut = products.filter((pr) => pr.in_stock === false).map((pr) => pr.name);
  if (soldOut.length) result.stock_note = `Out of stock in the store right now: ${soldOut.join('; ')}. Tell the user before making the post; do not mention availability in the post.`;
  const offers = products.filter((pr) => pr.offer);
  result.offer_note = offers.length
    ? 'There is an active public discount (see "offer" on the product). Any price or "-N%" in the post must be exactly these values; post_save checks it.'
    : 'No active public discount. Do not claim a discount, a sale or an old price; post_save checks it.';
  if (products.length && photos.length < products.length)
    result.product_photo_note = 'Not every product photo could be downloaded. Ask the user to attach the missing ones before generating images.';

  if (!library) {
    result.library = null;
    result.library_note =
      'No post library is installed, so there are no past posts or style reference images. Ask the user once whether they have a Google Drive link to their post library; if they do, call post_library_set with it and then post_start again. Otherwise write in a clear, friendly shop voice and describe the look fully in the image prompt.';
    result.baseline = { template: null, folder: join(folder, 'baseline'), style_refs: [] };
    return result;
  }

  refreshIfStale(); // newer library on Drive? fetch it in the background for next time
  const subject = { kind, topic, occasion, products };
  const ranked = kind === 'product' ? rank(library, products[0], productTypes) : rankForKind(library, subject);
  const forced = library.meta.templates?.[args?.template] !== undefined ? args.template : null;
  const template = forced || (kind === 'product' ? pickTemplate(library) : pickTemplateForKind(library, ranked));
  const refs2 = selectStyleRefs(library, ranked, template, products[0] || { url: null }, 2);
  result.page = { name: library.meta.page, about: library.meta.about, shop_url: library.meta.shop_url };
  result.baseline = { template, folder: join(folder, 'baseline'), style_refs: copyStyleRefs(refs2, join(folder, 'baseline')) };
  result.examples = selectExamples(ranked, 4).map(exampleForWriter);
  result.performance = performanceInsights(ranked, kind === 'product' ? productTypes : [kind]);
  result.templates = library.meta.templates;
  if (kind === 'product' && !productTypes.length)
    result.note = `No product_types were given, so examples are ranked without them. Allowed values: ${library.meta.product_types.join(', ')}.`;
  if (kind !== 'product' && !result.examples.length) result.note = `The page has no past ${kind} posts in the library, so there are no examples for this kind.`;
  return result;
}

const normalizeQuoted = (text) => String(text).replace(/["“”„]\s*\/\s*["“”„]/g, ' ').replace(/\s+/g, ' ').trim();

/** post_save: save one variant's brief, attach its reference images, and run the checks that need no model. */
export function postSave(args) {
  const folder = checkRunFolder(args?.folder);
  const variant = args?.variant;
  if (!VARIANT_RE.test(variant || '')) throw err('"variant" must be "baseline", "idea_1", "idea_2", …');
  for (const k of ['caption', 'image_prompt'])
    if (typeof args[k] !== 'string' || !args[k].trim()) throw err(`"${k}" is required.`);
  const imageText = Array.isArray(args.image_text) ? args.image_text.filter((b) => b && typeof b.text === 'string') : [];
  const product = JSON.parse(readFileSync(join(folder, 'product.json'), 'utf8'));
  const dir = join(folder, variant);
  mkdirSync(dir, { recursive: true });

  // Reference images, in the order the prompt refers to them: product photo first, then style references.
  const kind = product.kind || 'product';
  const attachments = [];
  for (const name of product.photos?.length ? product.photos : product.photo ? [product.photo] : []) {
    if (!existsSync(join(folder, name))) continue;
    const dest = join(dir, name);
    copyFileSync(join(folder, name), dest);
    attachments.push(dest);
  }
  const photoCount = attachments.length;
  let refs = readdirSync(dir).filter((f) => f.startsWith('style_ref_')).sort().map((f) => join(dir, f));
  const library = loadLibrary();
  const template = typeof args.template === 'string' ? args.template : null;
  if (!refs.length && library && template) {
    const ranked = kind === 'product' ? rank(library, product, product.product_types || []) : rankForKind(library, product);
    refs = copyStyleRefs(selectStyleRefs(library, ranked, template, product, 2), dir);
  }
  attachments.push(...refs);

  // Deterministic checks (from culy-posts): every in-image text quoted verbatim in the prompt; the product link in the caption.
  const issues = [];
  const prompt = normalizeQuoted(args.image_prompt);
  for (const b of imageText)
    if (!prompt.includes(normalizeQuoted(b.text)))
      issues.push({ severity: 'major', area: 'prompt', problem: `The in-image text "${b.text}" is not quoted word for word in the image prompt.`, fix: 'Quote it exactly, in double quotes, in the prompt.' });
  // One product: its link must be there. Several: at least one of them. No product: no link is required.
  const links = (product.products?.length ? product.products : [product]).map((pr) => pr.url).filter(Boolean);
  if (links.length && !links.some((l) => args.caption.includes(l)))
    issues.push({ severity: 'major', area: 'caption_formula', problem: links.length === 1 ? 'The product link is missing from the caption.' : 'None of the product links is in the caption.', fix: `Add ${links[0]} on its own line.` });
  // Prices and discount claims must be the store's own (single products and sets alike).
  const priced = product.products?.length ? product.products : product.url ? [product] : [];
  if (priced.length) issues.push(...checkPrices([args.caption, ...imageText.map((b) => b.text)], priced));
  if (!attachments.length)
    issues.push({ severity: 'major', area: 'prompt', problem: 'There are no reference images for this variant.', fix: links.length ? 'Ask the user to attach a product photo.' : 'Ask the user to attach an example image in the style they want, or describe the look fully in the prompt.' });

  const brief = {
    variant, template, aspect_ratio: args.aspect_ratio === '4:5' ? '4:5' : '1:1',
    caption: args.caption, image_text: imageText.map((b) => ({ role: String(b.role || 'text'), text: b.text })),
    image_prompt: args.image_prompt, notes: typeof args.notes === 'string' ? args.notes : '',
    idea: args.idea && typeof args.idea === 'object' ? args.idea : null,
    review_issues: Array.isArray(args.review_issues) ? args.review_issues : [],
    attachments: attachments.map((p) => basename(p)), saved_at: new Date().toISOString(),
  };
  writeFileSync(join(dir, 'brief.json'), JSON.stringify(brief, null, 2));
  const md = [
    `# ${product.name}`, '', product.url || '', '',
    `Variant: **${variant}**${template ? ` · Template: \`${template}\`` : ''} · Aspect ratio: ${brief.aspect_ratio}`, '',
    brief.idea?.title ? `**Idea:** ${brief.idea.title}${brief.idea.angle ? `: ${brief.idea.angle}` : ''}\n` : '',
    '## 1. Caption (paste into Facebook)', '', '```text', brief.caption, '```', '',
    '## 2. Image', '', 'Reference images, in this order:', '', ...brief.attachments.map((n, i) => `${i + 1}. \`${n}\``), '',
    '```text', brief.image_prompt, '```', '',
    '### Text that must appear in the image (check the spelling)', '', ...brief.image_text.map((t) => `- **${t.role}:** ${t.text}`), '',
    '## Notes', '', brief.notes, '',
  ].join('\n');
  writeFileSync(join(dir, 'brief.md'), md);

  return {
    variant_folder: dir,
    reference_images: attachments,
    reference_images_note:
      photoCount > 1
        ? `Load every one of these files into the conversation (view them) before generating the image, in this order: Images 1-${photoCount} are the product photos, the rest are style references.`
        : photoCount === 1
          ? 'Load every one of these files into the conversation (view them) before generating the image, in this order: Image 1 is the product photo, Image 2+ are style references.'
          : 'Load every one of these files into the conversation (view them) before generating the image: they are style references from the page. There is no product photo for this post.',
    issues,
  };
}

/** post_add_image: copy a generated image into the variant folder as image_<n>.png and optionally show it in the file manager. */
export function postAddImage(args) {
  const folder = checkRunFolder(args?.folder);
  if (!VARIANT_RE.test(args?.variant || '')) throw err('"variant" must be "baseline", "idea_1", "idea_2", …');
  const dir = join(folder, args.variant);
  if (!existsSync(join(dir, 'brief.json'))) throw err('Save the brief for this variant with post_save first.');
  const source = args?.source_path;
  if (typeof source !== 'string' || !source) throw err('"source_path" is required: the file path of the generated image.');
  const ext = extname(source).toLowerCase();
  let st;
  try {
    st = statSync(source);
  } catch {
    throw err(`File not found: ${source}`);
  }
  if (!st.isFile() || !IMAGE_EXT.has(ext) || st.size > MAX_IMAGE_BYTES) throw err('"source_path" must be a PNG, JPG or WEBP image file.');
  const n = 1 + readdirSync(dir).filter((f) => /^image_\d+\./.test(f)).length;
  const dest = join(dir, `image_${n}${ext}`);
  copyFileSync(source, dest);
  if (args.reveal && !process.env.CLOUDCART_NO_BROWSER) {
    const [cmd, cmdArgs] = process.platform === 'darwin' ? ['open', [folder]] : process.platform === 'win32' ? ['explorer', [folder]] : ['xdg-open', [folder]];
    try {
      spawn(cmd, cmdArgs, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
    } catch {
      // showing the folder is a convenience only
    }
  }
  return { image: dest, run_folder: folder };
}

/** A small JPEG copy of an image as a data URI, for the preview card. Null when it cannot be made small enough. */
function previewDataUri(file) {
  const LIMIT = 900 * 1024;
  try {
    if (process.platform === 'darwin') {
      const tmp = join(tmpdir(), `cc-preview-${process.pid}-${Date.now()}.jpg`);
      execFileSync('sips', ['-Z', '1080', '-s', 'format', 'jpeg', '-s', 'formatOptions', '78', file, '--out', tmp], { stdio: 'ignore', timeout: 20_000 });
      const buf = readFileSync(tmp);
      try { rmSync(tmp); } catch { /* temp file */ }
      if (buf.length <= LIMIT) return `data:image/jpeg;base64,${buf.toString('base64')}`;
    }
  } catch {
    // fall through to the original file
  }
  try {
    const buf = readFileSync(file);
    if (buf.length > LIMIT) return null;
    const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[extname(file).toLowerCase()];
    return mime ? `data:${mime};base64,${buf.toString('base64')}` : null;
  } catch {
    return null;
  }
}

function readScheduled(dir) {
  try {
    const j = JSON.parse(readFileSync(join(dir, 'scheduled.json'), 'utf8'));
    return { for: j.scheduled_for, permalink: j.permalink || null, page: j.page || null };
  } catch {
    return null;
  }
}

/** post_show: everything the preview card needs. Returns { summary, structuredContent, meta }. */
export function postShow(args) {
  const folder = checkRunFolder(args?.folder);
  const product = JSON.parse(readFileSync(join(folder, 'product.json'), 'utf8'));
  const library = loadLibrary();
  const variants = [];
  const images = {};
  for (const name of readdirSync(folder).sort((a, b) => (a === 'baseline' ? -1 : b === 'baseline' ? 1 : a.localeCompare(b)))) {
    const briefPath = join(folder, name, 'brief.json');
    if (!VARIANT_RE.test(name) || !existsSync(briefPath)) continue;
    const brief = JSON.parse(readFileSync(briefPath, 'utf8'));
    const shots = readdirSync(join(folder, name))
      .filter((f) => /^image_\d+\./.test(f))
      .sort((a, b) => parseInt(a.slice(6), 10) - parseInt(b.slice(6), 10));
    const latest = shots.length ? join(folder, name, shots[shots.length - 1]) : null;
    if (latest) {
      const uri = previewDataUri(latest);
      if (uri) images[name] = uri;
    }
    variants.push({
      variant: name,
      title: brief.idea?.title || null,
      angle: brief.idea?.angle || null,
      template: brief.template,
      caption: brief.caption,
      image_text: brief.image_text || [],
      issues: (brief.review_issues || []).map((i) => (typeof i === 'string' ? i : [i.problem, i.fix].filter(Boolean).join(' → '))).filter(Boolean),
      image_file: latest,
      scheduled: readScheduled(join(folder, name)),
    });
  }
  if (!variants.length) throw err('No saved variants in this folder yet. Call post_save first.');
  const selected = variants.some((v) => v.variant === args?.variant) ? args.variant : variants[0].variant;
  return {
    summary:
      `Showing a preview card with ${variants.length} variant(s): ` +
      variants.map((v) => `${v.variant}${v.image_file ? '' : ' (no image yet)'}${v.scheduled ? ` (scheduled on Facebook for ${v.scheduled.for})` : ''}`).join(', ') +
      `. Folder: ${folder}. If no card appears in this app, show the captions and image paths as text instead.`,
    structuredContent: {
      page: { name: library?.meta?.page || '' },
      product: { name: product.name, url: product.url },
      folder, selected, variants,
    },
    meta: { images },
  };
}

/** The folder of a saved variant, checked. Used by post_schedule. */
export function variantFolder(args) {
  const folder = checkRunFolder(args?.folder);
  if (!VARIANT_RE.test(args?.variant || '')) throw err('"variant" must be "baseline", "idea_1", "idea_2", …');
  const dir = join(folder, args.variant);
  if (!existsSync(join(dir, 'brief.json'))) throw err('Save the brief for this variant with post_save first.');
  return dir;
}
