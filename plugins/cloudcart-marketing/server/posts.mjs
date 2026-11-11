// Facebook post workflow: product -> working folder with the product photo, style reference
// images and example posts -> saved briefs and images. Adapted from the culy-posts project.
// Everything here is local file work plus read-only GETs to the store.
import { mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync, readdirSync, statSync, realpathSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, extname, basename, sep } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { loadConfig, getFromStore } from './lib.mjs';
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

/** post_start: read the product, create the working folder, fetch the photo, pick examples and style references. */
export async function postStart(args) {
  const cfg = loadConfig();
  if (!cfg.store || !cfg.apiKey) throw err('The store is not connected yet. Call cloudcart_connect first.');
  const productTypes = Array.isArray(args?.product_types) ? args.product_types.filter((t) => typeof t === 'string') : [];

  // Find the product by link (its last path segment is the URL handle) or by ID.
  let doc;
  let handle = null;
  let productUrl = null;
  if (typeof args?.product_url === 'string' && args.product_url.trim()) {
    let u;
    try {
      u = new URL(args.product_url.trim());
    } catch {
      throw err('"product_url" is not a valid link.');
    }
    handle = decodeURIComponent(u.pathname.replace(/\/$/, '').split('/').pop() || '');
    if (!/^[\p{L}\p{N}_-]+$/u.test(handle)) throw err('That link does not look like a product page.');
    productUrl = `${u.origin}${u.pathname.replace(/\/$/, '')}`;
    doc = await apiGet(cfg, 'products', `?${new URLSearchParams({ 'filter[url_handle]': handle, include: 'images' })}`);
  } else if (args?.product_id !== undefined && /^[A-Za-z0-9_-]+$/.test(String(args.product_id))) {
    doc = await apiGet(cfg, `products/${args.product_id}`, '?include=images');
  } else {
    throw err('Give "product_url" (the product page link) or "product_id".');
  }
  const data = Array.isArray(doc?.data) ? doc.data[0] : doc?.data;
  if (!data) throw err('No product with that link or ID was found in the store. Check the link.');
  const a = data.attributes || {};
  handle = a.url_handle || handle || String(data.id);

  const library = loadLibrary();
  if (!productUrl && library?.meta?.shop_url) productUrl = `${library.meta.shop_url.replace(/\/$/, '')}/product/${handle}`;

  // Brand and category are separate records; a failure here is not fatal.
  const related = async (rel, resource) => {
    const id = data.relationships?.[rel]?.data?.id;
    if (!id) return null;
    try {
      return (await apiGet(cfg, `${resource}/${id}`))?.data?.attributes?.name || null;
    } catch {
      return null;
    }
  };
  const [brand, category] = await Promise.all([related('vendor', 'vendors'), related('category', 'categories')]);

  const product = {
    id: String(data.id),
    url: productUrl,
    name: a.name || '',
    brand,
    category,
    price_from: typeof a.price_from === 'number' ? a.price_from / 100 : null,
    price_to: typeof a.price_to === 'number' ? a.price_to / 100 : null,
    active: a.active ?? null,
    description: htmlToText(a.description),
  };

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const folder = join(POSTS_ROOT, `${stamp}-${handle.slice(0, 60)}`);
  mkdirSync(join(folder, 'baseline'), { recursive: true });

  const images = (doc.included || [])
    .filter((r) => r.type === 'images' && r.attributes?.src)
    .sort((x, y) => (x.attributes.sort_order ?? 0) - (y.attributes.sort_order ?? 0));
  let photo = null;
  for (const img of images.slice(0, 3)) {
    try {
      photo = await downloadImage(img.attributes.src, join(folder, 'product'));
    } catch {
      photo = null;
    }
    if (photo) break;
  }

  writeFileSync(join(folder, 'product.json'), JSON.stringify({ ...product, photo: photo && basename(photo), product_types: productTypes }, null, 2));

  const result = {
    folder,
    product,
    product_photo: photo,
    product_photo_note: photo ? undefined : 'No product photo could be downloaded. Ask the user to attach one before generating images.',
  };

  if (!library) {
    result.library = null;
    result.library_note =
      'No post library is installed, so there are no past posts or style reference images. Write in a clear, friendly shop voice and describe the look fully in the image prompt.';
    result.baseline = { template: null, folder: join(folder, 'baseline'), style_refs: [] };
    return result;
  }

  const ranked = rank(library, product, productTypes);
  const template = library.meta.templates?.[args?.template] !== undefined ? args.template : pickTemplate(library);
  const refs = selectStyleRefs(library, ranked, template, product, 2);
  result.page = { name: library.meta.page, about: library.meta.about, shop_url: library.meta.shop_url };
  result.baseline = { template, folder: join(folder, 'baseline'), style_refs: copyStyleRefs(refs, join(folder, 'baseline')) };
  result.examples = selectExamples(ranked, 4).map(exampleForWriter);
  result.performance = performanceInsights(ranked, productTypes);
  result.templates = library.meta.templates;
  if (!productTypes.length)
    result.note = `No product_types were given, so examples are ranked without them. Allowed values: ${library.meta.product_types.join(', ')}.`;
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
  const attachments = [];
  if (product.photo && existsSync(join(folder, product.photo))) {
    const dest = join(dir, product.photo);
    copyFileSync(join(folder, product.photo), dest);
    attachments.push(dest);
  }
  let refs = readdirSync(dir).filter((f) => f.startsWith('style_ref_')).sort().map((f) => join(dir, f));
  const library = loadLibrary();
  const template = typeof args.template === 'string' ? args.template : null;
  if (!refs.length && library && template) {
    const ranked = rank(library, product, product.product_types || []);
    refs = copyStyleRefs(selectStyleRefs(library, ranked, template, product, 2), dir);
  }
  attachments.push(...refs);

  // Deterministic checks (from culy-posts): every in-image text quoted verbatim in the prompt; the product link in the caption.
  const issues = [];
  const prompt = normalizeQuoted(args.image_prompt);
  for (const b of imageText)
    if (!prompt.includes(normalizeQuoted(b.text)))
      issues.push({ severity: 'major', area: 'prompt', problem: `The in-image text "${b.text}" is not quoted word for word in the image prompt.`, fix: 'Quote it exactly, in double quotes, in the prompt.' });
  if (product.url && !args.caption.includes(product.url))
    issues.push({ severity: 'major', area: 'caption_formula', problem: 'The product link is missing from the caption.', fix: `Add ${product.url} on its own line.` });
  if (!attachments.length)
    issues.push({ severity: 'major', area: 'prompt', problem: 'There are no reference images for this variant.', fix: 'Ask the user to attach a product photo.' });

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
    reference_images_note: 'Load every one of these files into the conversation (view them) before generating the image, in this order: Image 1 is the product photo, Image 2+ are style references.',
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
    });
  }
  if (!variants.length) throw err('No saved variants in this folder yet. Call post_save first.');
  const selected = variants.some((v) => v.variant === args?.variant) ? args.variant : variants[0].variant;
  return {
    summary:
      `Showing a preview card with ${variants.length} variant(s): ` +
      variants.map((v) => `${v.variant}${v.image_file ? '' : ' (no image yet)'}`).join(', ') +
      `. Folder: ${folder}. If no card appears in this app, show the captions and image paths as text instead.`,
    structuredContent: {
      page: { name: library?.meta?.page || '' },
      product: { name: product.name, url: product.url },
      folder, selected, variants,
    },
    meta: { images },
  };
}
