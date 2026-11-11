# CloudCart Marketing plugin

A ChatGPT / Codex plugin that gives a CloudCart store owner a marketing assistant working from real store data: best sellers, slow movers, campaign ideas, product copy, social posts and email drafts.

It can only **read** from the store. It sends GET requests to the CloudCart REST API (`/api/v2`) and nothing else.

## Install

Give [INSTALL.md](INSTALL.md) to ChatGPT in the desktop app, in **Work** mode, and ask it to follow the instructions. Or run the commands in that file yourself.

The plugin runs a small local program, so it works only in the ChatGPT desktop app (Work mode) and the Codex CLI, not on chatgpt.com or the phone app.

## Connect the store

In a Work-mode chat, pick the plugin with `@` and write "Connect my CloudCart store". A page opens in the browser asking for the store address and an API key (CloudCart admin → Settings → API Keys). The key is saved on that computer in `~/.config/cloudcart-marketing/config.json` and is never sent to the chat.

CloudCart API keys have no read-only level, so create one just for this plugin and revoke it if you stop using it.

## What is inside

```
.agents/plugins/marketplace.json           catalog entry so Codex can find the plugin
plugins/cloudcart-marketing/
  plugin.json                              manifest
  mcp.json                                 declares the local MCP server
  server/index.mjs                         MCP server: cloudcart_status, cloudcart_connect, cloudcart_get
  server/connect.mjs                       the browser page for connecting the store
  server/lib.mjs                           config, validation, the single GET call
  server/setup.mjs                         terminal alternative to the browser page
  skills/store-marketing/SKILL.md          instructions for the assistant
  skills/store-marketing/references/       REST endpoint reference
```

No dependencies. Needs Node.js 18 or newer.

## Changing the plugin

Edit the files, raise `version` in `plugin.json`, commit and push. Then on each computer follow "Updating later" in INSTALL.md.
