---
name: setup
description: "Set up or check the CloudCart Marketing plugin: connect the store, add the post library link, confirm everything works. Use right after the plugin is installed, when the user asks to set up, configure or connect the plugin, or asks where its settings are. Also: настрой плъгина, свържи магазина, настройки, къде са настройките."
---

Get the plugin ready to use. The user runs a shop and is not a developer: answer in the language they write in, in plain words, a few lines at a time.

## What needs setting

1. **Store address** and **API key** (required). The key is made in the CloudCart admin under Settings → API Keys → Create API Key.
2. **Post library link** (optional): a Google Drive link to the shop's past Facebook posts. With it, new posts follow the page's own voice and look.

All three are saved only on this computer. The plugin can only read from the store.

## Steps

1. Call `cloudcart_status`. It reports whether the store is connected and whether the post library is installed.
2. **If the store is not connected:** call `cloudcart_connect`. A page opens in the browser with fields for the store address, the API key and the library link. Tell the user what to enter and where to find the key, and ask them to tell you when the page says the store is connected. Never ask for the API key in the chat; if they paste one, do not use or repeat it, and point them to the page.
3. **If the store is connected but there is no post library:** ask once whether they have a Google Drive link to their post library. If they give it, call `post_library_set` with it (up to a minute). If not, say that posts will still work, in a generic style, and that the link can be added later.
4. Call `cloudcart_status` again and confirm in one or two lines what is ready.
5. Finish with what they can do now: paste a product link and ask for a Facebook post, or ask about best sellers.

## Where the settings live

If they ask where to see or change these later: on the plugin's own page in ChatGPT (Plugins → CloudCart Marketing), under settings, or by asking you to "connect my store" again, which reopens the browser page.
