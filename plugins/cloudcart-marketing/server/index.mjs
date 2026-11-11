#!/usr/bin/env node
// CloudCart store MCP server (stdio). Reads from the store's REST JSON:API
// (/api/v2) with an API key. Strictly read-only: it can only send GET requests
// and there is no setting to change that. No dependencies.
import { createInterface } from 'node:readline';
import { RESOURCES, loadConfig, parsePath, buildSearch, getFromStore } from './lib.mjs';
import { openConnectPage } from './connect.mjs';

const SERVER_INFO = { name: 'cloudcart-store', version: '0.4.1' };
const MAX_RESULT_CHARS = 100_000;

const NOT_CONFIGURED =
  'The store is not connected yet. Call the cloudcart_connect tool: it opens a page in the browser where the user ' +
  'enters the store address and API key. Do not ask the user to paste the key into this chat.';

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
      'Open a page in the user\'s browser where they enter the store address and API key to connect (or reconnect) the store. ' +
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
      `Connected to ${cfg.store}${count !== undefined ? ` (${count} products)` : ''}. Read-only: this plugin cannot change anything in the store.`,
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
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions:
          'Reads data from one CloudCart store through its REST API. Call cloudcart_status first. Strictly read-only.',
      };
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: TOOLS };
    case 'tools/call': {
      const name = msg.params?.name;
      if (name === 'cloudcart_status') return status();
      if (name === 'cloudcart_get') return get(msg.params?.arguments);
      if (name === 'cloudcart_connect') return connect();
      throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32602 });
    }
    default:
      throw Object.assign(new Error(`Method not found: ${msg.method}`), { code: -32601 });
  }
}

const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
let pending = 0;
let closing = false;
rl.on('close', () => {
  closing = true; // host went away: finish what is in flight, then do not linger
  if (pending === 0) process.exit(0);
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
  if (closing && pending === 0) process.exit(0);
});
