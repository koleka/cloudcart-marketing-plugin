#!/usr/bin/env node
// CloudCart store MCP server (stdio). Reads from the store's REST JSON:API
// (/api/v2) with an API key. Strictly read-only: it can only send GET requests
// and there is no setting to change that. No dependencies.
import { createInterface } from 'node:readline';
import { RESOURCES, loadConfig, saveConfig, normalizeStore, parsePath, buildSearch, getFromStore } from './lib.mjs';
import { openConnectPage } from './connect.mjs';
import { readFileSync } from 'node:fs';
import { postStart, postSave, postAddImage, postShow } from './posts.mjs';
import { updatePlugin } from './update.mjs';
import { installFromLink, libraryStatus, isRefreshing, getLibraryLink, setLibraryLink } from './library-sync.mjs';

const CARD_URI = 'ui://cloudcart-marketing/post-card-v1.html';
const CARD_MIME = 'text/html;profile=mcp-app';
const CARD_RESOURCE = { uri: CARD_URI, name: 'Post preview card', description: 'Preview of a generated Facebook post: image, caption, checks.', mimeType: CARD_MIME };

const SERVER_INFO = { name: 'cloudcart-store', version: '0.8.0' };
const MAX_RESULT_CHARS = 100_000;

const NOT_CONFIGURED =
  'The store is not connected yet. Call the cloudcart_connect tool: it opens a page in the browser where the user ' +
  'enters the store address and API key. (The same settings are also on this plugin\'s page in ChatGPT.) ' +
  'Do not ask the user to paste the key into this chat.';

const TOOLS = [
  {
    name: 'cloudcart_status',
    title: 'CloudCart connection status',
    description: 'Check whether the CloudCart store is connected. Call this first in a conversation.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
  {
    name: 'cloudcart_connect',
    title: 'Connect the CloudCart store',
    description:
      'Open a page in the user\'s browser where they enter the store address, the API key and, optionally, a Google Drive link to their post library, to connect (or reconnect) the store. ' +
      'Use it when cloudcart_status says the store is not connected or the key was rejected, or when the user asks to connect or change the store. ' +
      'The key is typed into that page, never into the chat. Returns immediately; ask the user to say when they have finished, then call cloudcart_status.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'cloudcart_get',
    title: 'Read data from the CloudCart store',
    description:
      'Read from the connected CloudCart store through its REST JSON:API (GET /api/v2/...). Read-only: it cannot create, change or delete anything. ' +
      'Returns the JSON:API response: "data" (array for lists, object for one record), "included", "meta.total_count" and "links.next". ' +
      'Lists return 20 records per page by default (max 100); use params "page[size]" and "page[number]". ' +
      'Other params: "filter[column]" (exact match on any attribute), "sort" (prefix "-" for descending), "include" (related records), ' +
      '"append[type]" (computed attributes), "fields[type]" (only these attributes; use it to keep responses small). ' +
      'Money values are integers in cents (2999 = 29.99). Booleans are the strings "yes" and "no". ' +
      `Resources: ${RESOURCES.join(', ')}.`,
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Resource, optionally with an ID: "orders", "orders/5012", "products".',
        },
        params: {
          type: 'object',
          description:
            'Query parameters as a flat object, e.g. {"page[size]": 50, "sort": "-date_added", "filter[start_date]": "2026-03-01", "include": "products"}.',
          additionalProperties: { type: ['string', 'number', 'boolean'] },
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
  {
    name: 'post_start',
    title: 'Start a Facebook post for a product',
    description:
      'First step of making a Facebook post for one product. Reads the product from the store (name, brand, category, description, price), ' +
      'creates a working folder on this computer, downloads the product photo into it, and returns the page\'s own past posts most relevant ' +
      'to this product (captions, engagement, image analysis), what performed well, the image template to use for the baseline variant, ' +
      'and style reference image files copied into the folder. Does not change the store.',
    inputSchema: {
      type: 'object',
      properties: {
        product_url: { type: 'string', description: 'The product page link the user gave. Preferred.' },
        product_id: { type: 'string', description: 'Product ID, if there is no link.' },
        product_types: {
          type: 'array',
          items: { type: 'string' },
          description: 'One or more product type codes for ranking examples. Call once without it to see the allowed values if unsure.',
        },
        template: { type: 'string', description: 'Force the baseline image template (a code from "templates"). Usually omitted.' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: 'post_save',
    title: 'Save a post variant',
    description:
      'Save one variant of the post (caption, in-image texts, image prompt) into the working folder as brief.md and brief.json, copy its reference images ' +
      '(product photo first, then style references for the template) next to it, and run automatic checks. Returns the reference image file paths to load ' +
      'before generating the image, and any issues to fix. Call again with the same variant to overwrite after fixing.',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'The "folder" returned by post_start.' },
        variant: { type: 'string', description: '"baseline", "idea_1", "idea_2", …' },
        template: { type: 'string', description: 'Image template code for this variant.' },
        aspect_ratio: { type: 'string', enum: ['1:1', '4:5'] },
        caption: { type: 'string', description: 'The Facebook caption.' },
        image_text: {
          type: 'array',
          description: 'Every text element that must appear in the image.',
          items: { type: 'object', properties: { role: { type: 'string' }, text: { type: 'string' } }, required: ['text'] },
        },
        image_prompt: { type: 'string', description: 'The English image-generation prompt.' },
        notes: { type: 'string' },
        idea: { type: 'object', description: 'For idea variants: { title, angle, hook, headline, why }.' },
        review_issues: { type: 'array', items: { type: 'object' }, description: 'Open issues from your own review, if any.' },
      },
      required: ['folder', 'variant', 'caption', 'image_prompt'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'post_add_image',
    title: 'Keep a generated image',
    description:
      'Copy a generated image file into a variant\'s folder as image_<n>.png (numbering continues, earlier images are kept). ' +
      'Set reveal to true on the last image of a run to show the folder to the user.',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'The "folder" returned by post_start.' },
        variant: { type: 'string' },
        source_path: { type: 'string', description: 'Path of the generated image file on this computer.' },
        reveal: { type: 'boolean' },
      },
      required: ['folder', 'variant', 'source_path'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'post_library_set',
    title: 'Update the post library',
    description:
      'Download the shop\'s post library (its past Facebook posts and reference images, used for voice and look) from a Google Drive link and install it on this computer. ' +
      'Pass "url" when the user gives a Google Drive link to the library. Call without "url" to download the latest version from the saved link when the user asks to update the library. Takes up to a minute.',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'Google Drive share link to the library zip. Omit to refresh from the saved link.' } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: 'plugin_update',
    title: 'Update the plugin',
    description:
      'Install the newest published version of this plugin on this computer. Use only when the user asks to update or upgrade the plugin. ' +
      'Takes up to a minute. Afterwards tell the user to quit ChatGPT completely and open it again. Settings, the store connection and the post library are kept.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: 'post_show',
    title: 'Show the post as a card',
    description:
      'Show the saved post variants to the user as a preview card: the image, the caption with a copy button, the texts to check in the image, and open issues. ' +
      'Call it once at the end of a run, after the briefs are saved and the images are added, and again after a change. It only displays what post_save and post_add_image stored.',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'The "folder" returned by post_start.' },
        variant: { type: 'string', description: 'Variant to show first. Defaults to baseline.' },
      },
      required: ['folder'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: {
      ui: { resourceUri: CARD_URI },
      'openai/outputTemplate': CARD_URI,
      'openai/toolInvocation/invoking': 'Preparing the preview…',
      'openai/toolInvocation/invoked': 'Preview ready.',
    },
  },
];

// --- Settings on the plugin's page in ChatGPT -----------------------------------------------
const SETTINGS_CAPABILITY = { 'openai/settings': { readTool: 'settings_read', updateTool: 'settings_update' } };
const KEY_SAVED = '•••••••• (saved)';

function settingsValues() {
  const cfg = loadConfig();
  return { store: cfg.store || '', apiKey: cfg.apiKey ? KEY_SAVED : '', libraryUrl: getLibraryLink() };
}

function settingsRead() {
  return {
    schema: {
      type: 'object',
      properties: {
        store: { type: 'string', title: 'Store address', description: 'For example mystore.cloudcart.com', maxLength: 253 },
        apiKey: {
          type: 'string',
          title: 'API key',
          description: 'From your CloudCart admin: Settings → API Keys. Saved on this computer only and shown hidden once saved.',
          maxLength: 400,
        },
        libraryUrl: {
          type: 'string',
          title: 'Post library link',
          description: 'Optional. A Google Drive link to your past posts, so new posts follow your page\'s voice and look. Downloads in the background after you save it.',
          maxLength: 500,
        },
      },
    },
    values: settingsValues(),
    layout: [
      { kind: 'group', title: 'Store', items: [{ kind: 'property', property: 'store' }, { kind: 'property', property: 'apiKey' }, { kind: 'tool', tool: 'cloudcart_status', description: 'Check that the store and the post library are working.' }] },
      { kind: 'group', title: 'Facebook posts', items: [{ kind: 'property', property: 'libraryUrl' }, { kind: 'tool', tool: 'post_library_set', description: 'Download the newest version of the post library now.' }] },
      { kind: 'group', title: 'Plugin', items: [{ kind: 'tool', tool: 'plugin_update', description: 'Install the newest version of this plugin. Restart ChatGPT afterwards.' }] },
    ],
  };
}

function settingsUpdate(args) {
  const set = args?.set;
  if (!set || typeof set !== 'object' || Array.isArray(set)) throw Object.assign(new Error('"set" must be an object of changed settings.'), { expected: true });
  const cfg = loadConfig();
  let { store, apiKey } = cfg;
  if ('store' in set) {
    store = normalizeStore(String(set.store));
    if (!store) throw Object.assign(new Error('That does not look like a store address. Use something like mystore.cloudcart.com.'), { expected: true });
  }
  // The hidden placeholder, or an empty field, means "keep the saved key".
  if ('apiKey' in set && String(set.apiKey).trim() && String(set.apiKey).trim() !== KEY_SAVED) apiKey = String(set.apiKey).trim();
  if (store !== cfg.store || apiKey !== cfg.apiKey) saveConfig({ store: store || '', apiKey: apiKey || '' });
  if ('libraryUrl' in set) setLibraryLink(String(set.libraryUrl));
  return { values: settingsValues() };
}

const SETTINGS_TOOLS = [
  {
    name: 'settings_read',
    title: 'Read plugin settings',
    description: 'Used by the plugin settings page. Returns the settings schema and current values; the API key is never returned.',
    inputSchema: { type: 'object', additionalProperties: false },
    outputSchema: {
      type: 'object',
      properties: { schema: { type: 'object' }, values: { type: 'object' }, layout: { type: 'array', items: { type: 'object' } } },
      required: ['schema', 'values'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: { ui: { visibility: ['app'] } },
  },
  {
    name: 'settings_update',
    title: 'Update plugin settings',
    description: 'Used by the plugin settings page to save changed settings on this computer.',
    inputSchema: {
      type: 'object',
      properties: {
        set: {
          type: 'object',
          properties: { store: { type: 'string' }, apiKey: { type: 'string' }, libraryUrl: { type: 'string' } },
          minProperties: 1,
          additionalProperties: false,
        },
      },
      required: ['set'],
      additionalProperties: false,
    },
    outputSchema: { type: 'object', properties: { values: { type: 'object' } }, required: ['values'] },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    _meta: { ui: { visibility: ['app'] } },
  },
];

const ok = (text) => ({ content: [{ type: 'text', text }] });
const fail = (text) => ({ content: [{ type: 'text', text }], isError: true });

function describeHttpProblem(status) {
  if (status === 401)
    return 'The store rejected the API key (401). It may be wrong or revoked. Call cloudcart_connect so the user can enter a new one.';
  if (status === 403) return 'The API key does not have permission for this (403).';
  if (status === 404) return 'Not found (404). Check the resource name and ID.';
  if (status === 429) return 'Rate limit reached (429). Wait a minute and try again.';
  if (status >= 500) return `The store returned a server error (${status}).`;
  return null;
}

async function status() {
  const cfg = loadConfig();
  if (!cfg.store || !cfg.apiKey) return ok(NOT_CONFIGURED);
  try {
    const r = await getFromStore(cfg, 'products', '?page%5Bsize%5D=1', 15000);
    const problem = describeHttpProblem(r.status);
    if (problem) return fail(`Store: ${cfg.store}. ${problem}`);
    if (r.status >= 400 || !r.json) return fail(`Store: ${cfg.store}. Unexpected response (HTTP ${r.status}).`);
    const count = r.json?.meta?.total_count;
    return ok(
      `Connected to ${cfg.store}${count !== undefined ? ` (${count} products)` : ''}. Read-only: this plugin cannot change anything in the store. ${libraryStatus()}`,
    );
  } catch (e) {
    return fail(`Store: ${cfg.store}. Could not reach the store: ${e.message}`);
  }
}

async function get(args) {
  const cfg = loadConfig();
  if (!cfg.store || !cfg.apiKey) return fail(NOT_CONFIGURED);
  const p = parsePath(args?.path);
  if (p.error) return fail(p.error);
  const q = buildSearch(args?.params);
  if (q.error) return fail(q.error);

  let r;
  try {
    r = await getFromStore(cfg, p.path, q.search);
  } catch (e) {
    return fail(`Could not reach the store: ${e.message}`);
  }
  const problem = describeHttpProblem(r.status);
  if (!r.json) return fail(problem || `Unexpected non-JSON response (HTTP ${r.status}).`);

  let text = JSON.stringify(r.json);
  if (text.length > MAX_RESULT_CHARS)
    text =
      text.slice(0, MAX_RESULT_CHARS) +
      `\n… [truncated: the result was ${text.length} characters. Use a smaller "page[size]", fewer includes, or "fields[type]".]`;
  if (problem) text = `${problem}\n${text}`;
  if (r.rateLimitRemaining !== null && Number(r.rateLimitRemaining) < 10)
    text += `\n[Only ${r.rateLimitRemaining} requests left this minute. Slow down.]`;

  return r.status >= 400 ? fail(text) : ok(text);
}

async function connect() {
  try {
    const { url, opened } = await openConnectPage();
    return ok(
      (opened
        ? 'A "Connect your CloudCart store" page has opened in the browser. '
        : 'Could not open the browser automatically. Give the user this link to open themselves: ') +
        `${opened ? 'If it did not appear, the user can open this link: ' : ''}${url} ` +
        'It works only on this computer and for 15 minutes. Ask the user to fill it in and tell you when it says the store is connected, then call cloudcart_status.',
    );
  } catch (e) {
    return fail(`Could not start the connection page: ${e.message}`);
  }
}

async function handle(msg) {
  switch (msg.method) {
    case 'initialize':
      return {
        protocolVersion: msg.params?.protocolVersion || '2025-06-18',
        // Settings shown on the plugin's page in ChatGPT (OpenAI MCP Extensions: structured settings).
        capabilities: { tools: {}, resources: {}, extensions: SETTINGS_CAPABILITY, experimental: SETTINGS_CAPABILITY },
        serverInfo: SERVER_INFO,
        instructions:
          'Reads data from one CloudCart store through its REST API. Call cloudcart_status first. Strictly read-only.',
      };
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: [...TOOLS, ...SETTINGS_TOOLS] };
    case 'resources/list':
      return { resources: [CARD_RESOURCE] };
    case 'resources/templates/list':
      return { resourceTemplates: [] };
    case 'resources/read': {
      if (msg.params?.uri !== CARD_URI) throw Object.assign(new Error(`Unknown resource: ${msg.params?.uri}`), { code: -32002 });
      return {
        contents: [
          {
            uri: CARD_URI,
            mimeType: CARD_MIME,
            text: readFileSync(new URL('./post-card.html', import.meta.url), 'utf8'),
            _meta: { ui: { prefersBorder: false, permissions: { clipboardWrite: {} } } },
          },
        ],
      };
    }
    case 'tools/call': {
      const name = msg.params?.name;
      if (name === 'cloudcart_status') return status();
      if (name === 'cloudcart_get') return get(msg.params?.arguments);
      if (name === 'cloudcart_connect') return connect();
      if (name === 'plugin_update') {
        try {
          return ok(await updatePlugin());
        } catch (e) {
          return fail(e.expected ? e.message : `The update failed: ${e.message}`);
        }
      }
      if (name === 'settings_read') return { content: [], structuredContent: settingsRead() };
      if (name === 'settings_update') {
        try {
          return { content: [], structuredContent: settingsUpdate(msg.params?.arguments) };
        } catch (e) {
          return fail(e.expected ? e.message : `The settings could not be saved: ${e.message}`);
        }
      }
      if (name === 'post_library_set') {
        try {
          const r = await installFromLink(typeof msg.params?.arguments?.url === 'string' ? msg.params.arguments.url : undefined);
          return ok(`Post library installed: ${r.posts} posts and ${r.images} reference images${r.page ? ` from ${r.page}` : ''}.`);
        } catch (e) {
          return fail(e.expected ? e.message : `The library could not be installed: ${e.message}`);
        }
      }
      if (name === 'post_show') {
        try {
          const r = postShow(msg.params?.arguments || {});
          return { content: [{ type: 'text', text: r.summary }], structuredContent: r.structuredContent, _meta: r.meta };
        } catch (e) {
          return fail(e.expected ? e.message : `Something went wrong: ${e.message}`);
        }
      }
      const postTool = { post_start: postStart, post_save: postSave, post_add_image: postAddImage }[name];
      if (postTool) {
        try {
          return ok(JSON.stringify(await postTool(msg.params?.arguments || {})));
        } catch (e) {
          if (e.expected) return fail(e.message);
          return fail(`Something went wrong: ${e.message}`);
        }
      }
      throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32602 });
    }
    default:
      throw Object.assign(new Error(`Method not found: ${msg.method}`), { code: -32601 });
  }
}

const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
// A background library refresh may still be unpacking: give it up to two minutes.
function exitWhenIdle(waited = 0) {
  if (!isRefreshing() || waited > 120_000) process.exit(0);
  setTimeout(() => exitWhenIdle(waited + 500), 500);
}
let pending = 0;
let closing = false;
rl.on('close', () => {
  closing = true; // host went away: finish what is in flight, then do not linger
  if (pending === 0) exitWhenIdle();
});
rl.on('line', async (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  if (msg.id === undefined || msg.id === null) return; // notification: nothing to answer
  if (typeof msg.method !== 'string') return; // a response to us: ignore
  pending++;
  try {
    send({ jsonrpc: '2.0', id: msg.id, result: await handle(msg) });
  } catch (e) {
    send({ jsonrpc: '2.0', id: msg.id, error: { code: e.code || -32603, message: e.message } });
  }
  pending--;
  if (closing && pending === 0) exitWhenIdle();
});
