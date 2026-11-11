# CloudCart Marketing plugin

A ChatGPT / Codex plugin that gives a CloudCart store owner a marketing assistant working from real store data:

- **Facebook posts**: paste a product link and get a caption plus a generated image, as a main variant and alternative ideas, in the page's own voice and look, shown as a preview card. Also posts for several products, kits, educational tips and holidays.
- **Weekly plan**: "what should I post this week?" returns a plan of posts chosen from what is selling, new, on sale and not posted about lately, shown as a card with a button to make each post.
- **Store questions**: best sellers, slow movers, campaign ideas, product copy and email drafts.

It can only **read** from the store. It sends GET requests to the CloudCart REST API (`/api/v2`) and nothing else.

## Install

Give [INSTALL.md](INSTALL.md) to ChatGPT in the desktop app, in **Work** mode, and ask it to follow the instructions. Or run the commands in that file yourself.

The plugin runs a small local program, so it works only in the ChatGPT desktop app (Work mode) and the Codex CLI, not on chatgpt.com or the phone app.

## Settings

The plugin has three settings: the store address, the API key and an optional post library link. They can be entered in any of these places, and all of them write the same files on that computer:

- **The plugin's page in ChatGPT** (Plugins → CloudCart Marketing): the settings appear there with ChatGPT's own controls, plus buttons to check the connection and update the post library. The API key is shown hidden once saved.
- **The browser page** that opens when you ask the plugin to connect the store (described below).
- **Setup after installation**: ChatGPT's "Set up" action for the plugin runs a short guided setup.

Files, all under `~/.config/cloudcart-marketing/`: `config.json` (store and key), `library-link.json` (the link), `library/` (the downloaded posts).

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

Add `--zip post-library.zip` to also produce the file to share.

### Sharing the library through Google Drive

Upload `post-library.zip` to Google Drive and share it as "Anyone with the link" (Viewer). The link is unlisted but works for anyone who has it, so pass it on privately and keep it out of this repository.

On the other computer the link is given once: in the plugin's settings, on the connect page, during installation (INSTALL.md, step 6) or in the chat ("here is my post library link: …"). The plugin downloads and unpacks the library itself and looks for a newer version every 14 days, or when asked to update the library.

To publish a refreshed library, replace the file in place so the link stays the same: in Drive, right-click the file → File information → Manage versions → Upload new version.

## What is inside

```
.agents/plugins/marketplace.json           catalog entry so Codex can find the plugin
plugins/cloudcart-marketing/
  plugin.json                              manifest
  mcp.json                                 declares the local MCP server
  server/index.mjs                         MCP server: store tools and post tools
  server/posts.mjs                         post_start, post_save, post_add_image, post_show (post_library_set is in index.mjs)
  server/plan.mjs                          plan_start, plan_save, plan_show (weekly post plan)
  server/plan-card.html                    the plan card
  server/library.mjs                       ranking of past posts and style references
  server/library-sync.mjs                  download and install the library from Google Drive
  server/library-cli.mjs                   the same from the command line (used during installation)
  server/update.mjs                        the "Update the plugin" action
  server/post-card.html                    the preview card (MCP Apps UI)
  server/connect.mjs                       the browser page for connecting the store
  server/lib.mjs                           config, validation, the single GET call
  server/setup.mjs                         terminal alternative to the browser page
  skills/store-marketing/SKILL.md          instructions for the assistant
  skills/store-marketing/references/       REST endpoint reference
  skills/facebook-post/SKILL.md            the Facebook post workflow
  skills/weekly-plan/SKILL.md              how to compose the week
  skills/setup/SKILL.md                    guided setup, run by ChatGPT after installation
tools/build-post-library.mjs               builds the post library (not installed with the plugin)
```

No dependencies. Needs Node.js 18 or newer.

## Changing the plugin

Edit the files, raise `version` in `plugin.json`, commit and push.

To get the new version on a computer: open the plugin's page in ChatGPT and press **Update the plugin** under settings, or write "update the plugin" in a Work-mode chat, then quit and reopen ChatGPT. Settings, the store connection and the post library are kept. The manual commands are under "Updating later" in INSTALL.md.
