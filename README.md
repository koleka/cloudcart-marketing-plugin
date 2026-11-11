# CloudCart Marketing plugin

A ChatGPT / Codex plugin that gives a CloudCart store owner a marketing assistant working from real store data:

- **Facebook posts**: paste a product link and get a caption plus a generated image, as a main variant and alternative ideas, in the page's own voice and look, shown as a preview card.
- **Store questions**: best sellers, slow movers, campaign ideas, product copy and email drafts.

It can only **read** from the store. It sends GET requests to the CloudCart REST API (`/api/v2`) and nothing else.

## Install

Give [INSTALL.md](INSTALL.md) to ChatGPT in the desktop app, in **Work** mode, and ask it to follow the instructions. Or run the commands in that file yourself.

The plugin runs a small local program, so it works only in the ChatGPT desktop app (Work mode) and the Codex CLI, not on chatgpt.com or the phone app.

## Connect the store

In a Work-mode chat, pick the plugin with `@` and write "Connect my CloudCart store". A page opens in the browser asking for the store address and an API key (CloudCart admin → Settings → API Keys). The key is saved on that computer in `~/.config/cloudcart-marketing/config.json` and is never sent to the chat.

CloudCart API keys have no read-only level, so create one just for this plugin and revoke it if you stop using it.

## Facebook posts

The flow is adapted from the culy-posts project: read the product from the store, pick the page's own most relevant past posts as examples (same product, same product type, engagement, recency), propose ideas, write and review each variant, then generate the image with the real product photo and recent posts from the page as reference images. Results are saved under `Documents/CloudCart Marketing/posts/<date>-<product>/` and shown as a card in the chat.

Images are made with ChatGPT's built-in image generation, so no OpenAI API key is needed.

### The post library

Examples and style references come from a "post library": an index of the page's past posts plus a small set of recent post images. It is the shop's own data, lives in `~/.config/cloudcart-marketing/library`, and is **not** in this repository. Without it the plugin still makes posts, in a generic style.

Build it from a culy-posts folder (Facebook export + analysis):

```
node tools/build-post-library.mjs /path/to/culy-posts --page "Page name" --about "what the shop sells" --shop-url https://shop.example.com
```

To move it to another computer, zip the contents of the library folder as `post-library.zip` and follow the optional step in INSTALL.md.

## What is inside

```
.agents/plugins/marketplace.json           catalog entry so Codex can find the plugin
plugins/cloudcart-marketing/
  plugin.json                              manifest
  mcp.json                                 declares the local MCP server
  server/index.mjs                         MCP server: store tools and post tools
  server/posts.mjs                         post_start, post_save, post_add_image, post_show
  server/library.mjs                       ranking of past posts and style references
  server/post-card.html                    the preview card (MCP Apps UI)
  server/connect.mjs                       the browser page for connecting the store
  server/lib.mjs                           config, validation, the single GET call
  server/setup.mjs                         terminal alternative to the browser page
  skills/store-marketing/SKILL.md          instructions for the assistant
  skills/store-marketing/references/       REST endpoint reference
  skills/facebook-post/SKILL.md            the Facebook post workflow
tools/build-post-library.mjs               builds the post library (not installed with the plugin)
```

No dependencies. Needs Node.js 18 or newer.

## Changing the plugin

Edit the files, raise `version` in `plugin.json`, commit and push. Then on each computer follow "Updating later" in INSTALL.md.
