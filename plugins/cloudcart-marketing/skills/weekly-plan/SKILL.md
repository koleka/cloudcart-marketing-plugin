---
name: weekly-plan
description: "Plan what to post on the shop's Facebook page this week: which products, what kind of post, which day, and why, based on what is new, selling, on sale and not posted about lately. Use when the user asks what to post, for a content plan, a posting calendar or ideas for the week. Also: какво да пусна, какво да публикувам тази седмица, план за постове, план за седмицата, календар с постове, идеи за постове."
---

Suggest this week's Facebook posts for the shop, so the owner does not have to decide from scratch.

**The user** runs the shop and is not a developer. Answer in the language they write in (usually Bulgarian), briefly, in plain words. Nothing here changes the store or publishes anything.

## Step 1 — Gather

Call `cloudcart_status`; if the store is not connected, call `cloudcart_connect` and wait. Then call `plan_start` (pass `posts` if they asked for a number; the default is 5).

It returns:

- `candidates`: products worth posting about, each with `signals`: `best_seller_rank`, `units_sold_30d`, `revenue_30d`, `new_since`, `on_sale`, `last_posted` (date of the last post about it, or null), `posts_about_it`, plus `in_stock`, `price`, `url`.
- `page`: how many posts of each type went out in the last 30 days, which post types and which weekdays and hours got the best engagement over the last year.
- `today`, `weekday_today`, `currency`.

## Step 2 — Compose the plan

Pick `posts_wanted` posts for the next 7 days, starting tomorrow. Rules, in order of importance:

1. **Never plan a product that is out of stock** (`in_stock: false`).
2. **Each post needs a reason that is true now**: it is new, it is selling, it is on sale, a season or holiday in the coming week fits it, or it sells well but has not been posted about for a long time.
3. **Do not repeat.** Skip products posted about in the last 6 weeks unless they are on sale or newly restocked. One post per product per week.
4. **Mix the week.** Not five product ads in a row: if the page's own numbers show that educational or other posts do well, give one or two slots to them, tied to a product from the candidates where it fits. Use the `kind` values `product`, `sale`, `multi_product`, `kit`, `education`, `seasonal`.
5. **Spread brands and categories** rather than five posts for one brand.
6. **Days and times**: prefer the weekdays and hours that performed best for this page; one post per day at most.

For each post decide: `day` (YYYY-MM-DD), `time` (HH:MM, optional), `kind`, `title` (a short working title in the user's language), `product_name`, `product_url` (from the candidate; omit for posts without a product), and `reason` (one sentence in the user's language, with the number that justifies it, for example "3-ти най-продаван за месеца, последен пост през март").

Call `plan_save` with `items` and a one-sentence `note` about the week, then `plan_show`. It displays the plan as a card with a "make this post" button on each line.

## Step 3 — Tell them

In three or four lines: the idea of the week and anything notable in the numbers (a product selling unusually well, something new that has never been posted). Then say they can press the button on a line, or tell you which one to make, or ask you to swap something. If the card did not appear, list the plan as a short numbered list.

When they pick a line, continue with the `facebook-post` skill, using the kind of post from that line (`sale` is a `product` post that leads with the offer).

## Changes

"Swap Wednesday", "more new products", "nothing from brand X": adjust the items, `plan_save` again and `plan_show`. Do not call `plan_start` again unless they ask for fresh data.
