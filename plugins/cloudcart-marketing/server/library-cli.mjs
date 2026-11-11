#!/usr/bin/env node
// Command-line access to the post library, for use right after installing the
// plugin (before its tools are loaded in a chat).
//   node library-cli.mjs set "<Google Drive link>"   download and install
//   node library-cli.mjs update                      download again from the saved link
//   node library-cli.mjs status
import { installFromLink, libraryStatus } from './library-sync.mjs';

const [command, link] = process.argv.slice(2);
try {
  if (command === 'status') {
    console.log(libraryStatus());
  } else if (command === 'set' || command === 'update') {
    if (command === 'set' && !link) throw Object.assign(new Error('Usage: library-cli.mjs set "<Google Drive link>"'), { expected: true });
    console.log('Downloading the post library…');
    const r = await installFromLink(command === 'set' ? link : undefined);
    console.log(`Installed: ${r.posts} posts, ${r.images} images${r.page ? ` (${r.page})` : ''}, ${(r.bytes / 1e6).toFixed(1)} MB.`);
  } else {
    console.log('Usage: library-cli.mjs set "<Google Drive link>" | update | status');
    process.exit(command ? 1 : 0);
  }
} catch (e) {
  console.error(e.expected ? e.message : `Failed: ${e.message}`);
  process.exit(1);
}
