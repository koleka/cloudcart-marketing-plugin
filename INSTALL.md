# Install the CloudCart Marketing plugin

**This file is written for an AI assistant (ChatGPT in Work mode, or Codex) to follow on the user's computer.** If you are a person, give this file to ChatGPT in the desktop app, in **Work** mode, with the message: "Follow these instructions to install the plugin."

## For the assistant

You are installing a ChatGPT / Codex plugin called **CloudCart Marketing** for a store owner who is not a developer. Follow the steps in order and run the commands yourself.

Rules:

- Talk to the user in the language they write in, in plain words. Do not explain commands unless they ask.
- Run only the commands in this file. If one fails, show the exact error and stop; do not improvise a workaround.
- Never ask for the store's API key, and do not accept one pasted into the chat. The plugin collects it on its own page after installation.
- You must be running locally on the user's computer (ChatGPT desktop app in Work mode, or the Codex CLI). If you cannot run shell commands on their computer, say so and stop: this plugin cannot be installed from the ChatGPT website or the phone app.

### Step 1 — Find the `codex` command

Try `codex --version`. If it is not found, use the copy bundled with the ChatGPT desktop app instead, and use that full path wherever the steps below say `codex`:

- macOS: `/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex`

If neither exists, tell the user the ChatGPT desktop app needs to be installed or updated, and stop.

### Step 2 — Check Node.js

The plugin needs Node.js 18 or newer. Run:

```
node --version
```

- Prints `v18` or higher → continue.
- Not found, or older → on macOS with Homebrew (`brew --version` works), tell the user in one sentence that you are installing Node.js and run `brew install node`. Otherwise ask the user to install the LTS version from https://nodejs.org and tell you when it is done, then check again.

### Step 3 — Add the plugin source

```
codex plugin marketplace add koleka/cloudcart-marketing-plugin
```

If it reports that the marketplace already exists, refresh it instead:

```
codex plugin marketplace upgrade cloudcart-marketing
```

### Step 4 — Install the plugin

```
codex plugin add cloudcart-marketing@cloudcart-marketing
```

If it is already installed and you are updating, remove it first with `codex plugin remove cloudcart-marketing@cloudcart-marketing`, then run the `add` command again.

### Step 5 — Verify

```
codex plugin list
```

Find the line for `cloudcart-marketing@cloudcart-marketing`. It must say `installed, enabled`. If it does not, show the user that line and stop.

### Step 6 — Optional: the post library

The plugin can write Facebook posts in the shop's own voice and look if it has the shop's "post library" (past posts and a few of their images). It is not part of the plugin download.

Ask the user whether they were given a Google Drive link to their post library. If yes, run this with their link in the quotes (it downloads about 40 MB and can take a minute):

```
node ~/.codex/plugins/cache/cloudcart-marketing/cloudcart-marketing/*/server/library-cli.mjs set "<the Google Drive link>"
```

It must end with a line starting `Installed:`. If it reports an error, show the user the message and continue with the next step; the library can be set later from the chat. If they have no link, skip this step: the plugin still works, with a generic style.

The plugin checks the same link for a newer library by itself from time to time.

### Step 7 — Tell the user what to do next

Say this, in their language:

1. Quit ChatGPT completely and open it again.
2. On the home screen choose **Work** (not Chat). The plugin only works in Work mode in the desktop app.
3. Start a new chat, type `@`, choose **CloudCart Marketing**, and write: *Connect my CloudCart store*.
4. A page opens in the browser. Enter the store address and the API key. The key is created in the CloudCart admin under **Settings → API Keys → Create API Key**.
5. When the page says the store is connected, go back to the chat and paste a product link with: *Make a Facebook post for this product*. Or ask, for example: *What are my best-selling products this month?*

Also tell them: the plugin can only read from the store. It cannot change products, prices, orders or anything else. If they later add their Facebook Page details in the settings, it can schedule a finished post on the Page, but only after they confirm each one. The store address, API key and library link can be seen and changed later on the plugin's page in ChatGPT (Plugins → CloudCart Marketing).

## Updating later

The easy way: on the plugin's page in ChatGPT press **Update the plugin**, or write "update the plugin" in a Work-mode chat, then restart ChatGPT.

By hand: run Step 3's `upgrade` command, then Step 4's `add` command, then restart ChatGPT. The store connection, settings and post library are kept.

## Removing

```
codex plugin remove cloudcart-marketing@cloudcart-marketing
codex plugin marketplace remove cloudcart-marketing
```

To also forget the store connection and the post library, delete the folder `~/.config/cloudcart-marketing`. Posts already made stay in `Documents/CloudCart Marketing/posts`.
