// Update this plugin to the newest published version by asking Codex to refresh
// its source and reinstall. Runs only when the user asks (a button on the plugin's
// settings page, or "update the plugin" in chat). No background checks.
import { execFile } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const fail = (message) => Object.assign(new Error(message), { expected: true });
const DEFAULT_NAME = 'cloudcart-marketing';

/** Marketplace and plugin names, read from where this file is installed: …/plugins/cache/<marketplace>/<plugin>/<version>/server/ */
function installedIdentity() {
  const parts = fileURLToPath(import.meta.url).split(sep);
  const i = parts.lastIndexOf('cache');
  if (i > 0 && parts[i - 1] === 'plugins' && parts.length >= i + 5) return { marketplace: parts[i + 1], plugin: parts[i + 2] };
  return { marketplace: DEFAULT_NAME, plugin: DEFAULT_NAME }; // running from a source checkout
}

function findCodex() {
  const candidates = [
    process.env.CODEX_CLI_PATH,
    '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex',
    join(homedir(), 'Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex'),
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p)) || 'codex'; // last resort: whatever is on PATH
}

const run = (cmd, args) =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout: 180_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ ok: !error, missing: error?.code === 'ENOENT', output: `${stdout}\n${stderr}`.trim() });
    });
  });

const versionKey = (v) => v.split(/[.+-]/).map((n) => String(parseInt(n, 10) || 0).padStart(6, '0')).join('.');

/** Highest version folder Codex has installed for this plugin, or null. */
function installedVersion({ marketplace, plugin }) {
  const dir = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'plugins', 'cache', marketplace, plugin);
  try {
    const versions = readdirSync(dir).filter((v) => /^\d+\.\d+/.test(v));
    return versions.sort((a, b) => (versionKey(a) < versionKey(b) ? -1 : 1)).pop() || null;
  } catch {
    return null;
  }
}

/** Returns a sentence for the user. Throws an expected error with a plain explanation on failure. */
export async function updatePlugin() {
  const id = installedIdentity();
  const codex = findCodex();
  const before = installedVersion(id);

  const refresh = await run(codex, ['plugin', 'marketplace', 'upgrade', id.marketplace]);
  if (refresh.missing) throw fail('The update could not start: the Codex command that comes with ChatGPT was not found on this computer.');
  if (!refresh.ok) throw fail(`The newest version could not be fetched. Check the internet connection and try again. (${refresh.output.split('\n').pop()})`);

  const install = await run(codex, ['plugin', 'add', `${id.plugin}@${id.marketplace}`]);
  if (!install.ok) throw fail(`The new version was fetched but could not be installed. (${install.output.split('\n').pop()})`);

  const after = installedVersion(id) || /cache\/[^/]+\/[^/]+\/([^\s/]+)/.exec(install.output)?.[1] || null;
  if (before && after && before === after) return `The plugin is already the newest version (${after}).`;
  return `Updated${before ? ` from version ${before}` : ''} to version ${after || 'the newest'}. Quit ChatGPT completely and open it again to start using it.`;
}
