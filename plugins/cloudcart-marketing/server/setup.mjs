#!/usr/bin/env node
// One-time setup: asks for the store address and a REST API key, checks them
// against the store, and saves them for the MCP server.
// Terminal alternative to the browser page the plugin opens (cloudcart_connect tool).
// Run in a terminal:  node server/setup.mjs
import { createInterface } from 'node:readline';
import { CONFIG_PATH, normalizeStore, loadConfig, checkConnection, saveConfig } from './lib.mjs';

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      // Print the question once, then swallow the echo of what is typed.
      process.stdout.write(question);
      rl._writeToOutput = () => {};
      rl.question('', (answer) => {
        rl.close();
        process.stdout.write('\n');
        resolve(answer.trim());
      });
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

const current = loadConfig();

console.log('CloudCart Marketing plugin setup\n');
console.log('You need a REST API key from your CloudCart admin:');
console.log('  Settings -> API Keys -> Create API Key (name it e.g. "ChatGPT marketing plugin").\n');

const storeInput = await ask(
  `Store address, e.g. mystore.cloudcart.com${current.store ? ` [${current.store}]` : ''}: `,
);
const store = normalizeStore(storeInput || current.store || '');
if (!store) {
  console.error('That does not look like a store address. Nothing was saved.');
  process.exit(1);
}

const apiKey = await ask('API key (input is hidden): ', { hidden: true });
if (!apiKey) {
  console.error('No key entered. Nothing was saved.');
  process.exit(1);
}

process.stdout.write(`Checking ${store} ... `);
const check = await checkConnection(store, apiKey);
if (!check.ok) {
  const why = {
    bad_key: 'the store rejected the key',
    bad_response: 'unexpected response. Is the store address right?',
    unreachable: 'could not reach the store',
    bad_store: 'that does not look like a store address',
  }[check.reason];
  console.error(`${why}. Nothing was saved.`);
  process.exit(1);
}
console.log(check.productCount !== undefined ? `ok (${check.productCount} products)` : 'ok');

saveConfig({ store, apiKey });

console.log(`\nSaved to ${CONFIG_PATH} (readable only by you).`);
console.log('The plugin only ever sends read (GET) requests to the store.');
