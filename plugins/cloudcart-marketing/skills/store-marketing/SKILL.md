---
name: store-marketing
description: "Marketing help for a CloudCart online store. Use when the user wants to: see best sellers, slow-moving products, recent orders or customers, get campaign or promotion ideas, write product descriptions, draft a marketing email or newsletter, plan a sale or discount. Also: маркетинг, кампания, промоция, отстъпка, най-продавани продукти, описание на продукт, имейл до клиенти, бюлетин."
---

Help a CloudCart store owner with marketing, using real data from their store.

**Core principle:** The user runs a store and is not a developer. Reply in the language they write in (often Bulgarian). Never mention APIs, endpoints, JSON or keys unless they ask. Show results as short plain summaries and ready-to-use text.

**Read-only rule:** This plugin can only read from the store. It cannot change prices, products, discounts, customers or anything else, and you must not try. If the user asks for a change, prepare it for them (the exact text, price or discount settings) and tell them where to apply it themselves in the CloudCart admin.

## Step 0 — Check the store connection

Call the `cloudcart_status` tool.

- **Connected** → continue.
- **Not connected, or the key was rejected** → call the `cloudcart_connect` tool. It opens a "Connect your CloudCart store" page in the browser. Tell the user, in one or two plain sentences, that a page has opened where they enter their store address and API key (found in the CloudCart admin under Settings → API Keys), and ask them to tell you when it says the store is connected. If the tool reports the browser did not open, give them the link it returned. When they confirm, call `cloudcart_status` again. Never ask the user to paste an API key into the chat, and if they do paste one, do not use or repeat it: point them to the page instead.

## Step 1 — Understand what they want

If the request is already concrete, go straight to it. Otherwise offer:

1. **Store snapshot** — best sellers, slow movers, recent orders
2. **Campaign or promotion ideas** based on what is selling
3. **Product copy** — descriptions, titles, SEO text
4. **Facebook post** for a product, with an image (use the `facebook-post` skill for this)
5. **Email / newsletter draft**

## Step 2 — Get the data

Use the `cloudcart_get` tool. It takes a `path` (a resource, optionally with an ID) and `params` (query parameters). Read `references/rest-api.md` in this skill folder for the list of resources and the filters, sorts and includes each one supports. Do not guess parameter names that are not listed there.

Common starting points:

| Need | Call |
|---|---|
| Orders in a period, with line items | `path: "orders"`, `params: {"filter[start_date]": "2026-03-01", "filter[end_date]": "2026-03-31", "include": "products", "page[size]": 100}` |
| Newest products | `path: "products"`, `params: {"sort": "-date_added", "page[size]": 20}` |
| Most viewed products | `path: "products"`, `params: {"sort": "-views", "page[size]": 20}` |
| One product with variants and current discount | `path: "products/142"`, `params: {"include": "variants,images", "append[products]": "meta,discount"}` |
| Active discounts | `path: "discounts"` |
| Newsletter subscribers and segments | `path: "subscribers"`, `path: "segments"` |

Rules for reading:

- **Best sellers are computed, not fetched.** There is no best-seller endpoint: fetch the orders for the period with `include: "products"`, then add up quantities and revenue per product from the line items yourself.
- **Paginate.** Lists return 20 records by default and at most 100. Keep requesting `page[number]` + 1 while the response has `links.next`. Check `meta.page.total` first, and if a full read would take more than about 20 requests, narrow the period or tell the user you are working from a sample.
- **Keep responses small.** Use `fields[type]` to request only the attributes you need, and only the includes you need.
- **Money is in cents.** `2999` means 29.99. Convert before showing it, and use the order's `currency`.
- **Booleans are `"yes"` / `"no"`.**
- **Privacy.** Do not include customer names, emails, phones or addresses in your reply unless the user asks for them.

## Step 3 — Deliver something usable

- **Snapshot:** a short list with numbers (units sold, revenue, stock), the period it covers, and two or three observations worth acting on.
- **Ideas:** three to five concrete suggestions, each tied to something in the data (for example "X sells well but Y in the same category does not — bundle them").
- **Copy, posts, emails:** write the finished text, ready to paste, using the real product name, price and details from the store. Offer one alternative version in a different tone.

State plainly when the data is missing or too thin to support a conclusion, rather than guessing.
