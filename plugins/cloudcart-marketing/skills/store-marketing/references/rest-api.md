# CloudCart REST API reference (read endpoints)

Condensed from https://cloudcart.dev/docs/rest-api. Paths are what you pass as `path` to `cloudcart_get`.

## Conventions

- `page[size]` (default 20, max 100) and `page[number]`. `meta.total_count` is the total; `links.next` is absent on the last page.
- `filter[column]=value` is an exact match and works on any attribute you see in a response. Several filters combine with AND. Resource-specific filters are listed below.
- `sort=field`, or `sort=-field` for descending. Only the sorts listed per resource are documented.
- `include=a,b` side-loads related records into the top-level `included` array. Nested: `include=variants.images`.
- `append[type]=x,y` adds computed attributes that are not returned by default.
- `fields[type]=a,b` returns only those attributes (works for included types too).
- Money is an integer in cents (`2999` = 29.99). Booleans are `"yes"` / `"no"`.
- Some filters (such as `filter[url_handle]`) return `data` as a single object instead of an array.

## Authors

Retrieve blog post authors — read-only admin user profiles.

GET: `/authors`, `/authors/{id}`

## Blogs

Create and manage blogs in your CloudCart store via the REST JSON:API.

GET: `/blogs`, `/blogs/{id}`

**Sorting**

- `?sort=name` — A to Z
- `?sort=-name` — Z to A
- `?sort=-created_at` — newest first
- `?sort=updated_at` — oldest updates first
- `?sort=id` — by ID

**Filtering**

- `?filter[url_handle]=store-news` — look up by slug. Returns a **single object**, not an array.

## Blog Posts

Create, update, and manage blog posts in your CloudCart store via the REST JSON:API.

GET: `/posts`, `/posts/{id}`

**Include paths**

- `?include=blog` — the parent blog
- `?include=author` — the post author
- `?include=tags` — all associated tags
- `?include=blog,author,tags` — everything at once

**Sorting**

- `?sort=name` — alphabetical
- `?sort=-name` — reverse alphabetical
- `?sort=-created_at` — newest first
- `?sort=updated_at` — oldest updates first
- `?sort=id` — by ID

**Filtering**

- `?filter[url_handle]=summer-collection` — look up by slug. Returns a **single object**, not an array.

## Tags

Manage blog post tags for content categorization.

GET: `/tags`, `/tags/{id}`

**Sorting**

- `?sort=tag` — alphabetical
- `?sort=-tag` — reverse alphabetical
- `?sort=id` — by ID

**Filtering**

- `?filter[url_handle]=summer` — look up by slug. Returns a **single object**, not an array.

## Customer Addresses

Manage customer shipping and billing addresses via the REST JSON:API.

GET: `/customer-billing-address`, `/customer-billing-address/{id}`, `/customer-shipping-address`, `/customer-shipping-address/{id}`

**Sorting**

- `?sort=country_iso2` — alphabetical by country
- `?sort=-id` — newest first

## Customer Groups

Manage customer groups and discount tiers in your CloudCart store.

GET: `/customer-groups`, `/customer-groups/{id}`

**Sorting**

- `?sort=name` — A to Z
- `?sort=-id` — newest first

**Filtering**

| Filter | Description |
| `filter[name]` | Match by group name. Returns a **single object**, not an array. |

## Customer Tags

Manage tags assigned to customers for segmentation and organization.

GET: `/customer-tags`, `/customer-tags/{id}`

**Sorting**

- `?sort=tag` — alphabetical
- `?sort=-url_handle` — reverse alphabetical by handle

## Customers

Manage customer accounts in your CloudCart store — create, update, list, and delete.

GET: `/customers`, `/customers/{id}`

**Include paths**

- `?include=group` — customer group with discount info
- `?include=orders` — all orders placed by this customer
- `?include=shipping-address` — default shipping address
- `?include=shipping-addresses` — all saved shipping addresses
- `?include=billing-address` — default billing address
- `?include=billing-addresses` — all saved billing addresses
- `?include=group,shipping-addresses,billing-addresses` — combine multiple includes

**Sorting**

- `?sort=last_name` — A to Z
- `?sort=-date_added` — newest first
- `?sort=email` — alphabetical by email
- `?sort=-date_banned` — recently banned first

**Filtering**

| Filter | Description |
| `filter[email]` | Match by exact email. Must be a valid email address. Returns a **single object**, not an array. |

## Discount Codes Pro

Advanced discount codes with per-code conditions, usage limits, and customer-group targeting.

GET: `/discount-codes-pro`, `/discount-codes-pro/{id}`

## Discount Codes

Create, manage, and bulk-generate redeemable discount codes via the REST JSON:API.

GET: `/discount-codes`, `/discount-codes/{id}`

**Sorting**

- `?sort=code` — alphabetical
- `?sort=-created_at` — newest first
- `?sort=active` — inactive first
- `?sort=-updated_at` — most recently updated first
- `?sort=id` — by ID

## Discounts

Create, list, update and delete discount campaigns (fixed, percent, flat, free shipping, code-pro) and their targets via the CloudCart REST JSON:API.

GET: `/discounts`, `/discounts/{id}`

## Product Discounts

Manage the association between products and discounts — set specific prices for products within a discount.

GET: `/product-to-discount`, `/product-to-discount/{id}`

**Sorting**

- `?sort=id` -- by ID
- `?sort=-created_at` -- newest first
- `?sort=date_start` -- earliest start date first
- `?sort=-date_end` -- latest end date first
- `?sort=-updated_at` -- most recently updated first

## Segments

Read customer segments — regular and automated — and their subscriber relationships.

GET: `/segments`, `/segments/{id}`

**Include paths**

- `?include=subscribers` — the segment's subscribers in one request

## Subscriber Channels

Manage subscriber communication channels (Email, Phone, Viber) for marketing.

GET: `/subscribers-channels`, `/subscribers-channels/{id}`

**Include paths**

- `?include=subscriber` -- the parent subscriber

**Sorting**

- `?sort=subscriber_id` -- by subscriber
- `?sort=channel` -- by channel type
- `?sort=channel_identifier` -- by identifier

## Subscriber Tags

Manage tags assigned to subscribers for segmentation.

GET: `/subscribers-tags`, `/subscribers-tags/{id}`

**Include paths**

- `?include=subscriber` -- the subscriber
- `?include=tag` -- the tag
- `?include=subscriber,tag` -- both at once

## Subscribers

Manage newsletter subscribers in your CloudCart store — create, update, list, and delete.

GET: `/subscribers`, `/subscribers/{id}`

**Include paths**

- `?include=channels` — subscriber's marketing channels
- `?include=tags` — subscriber's tags
- `?include=channels,tags` — both at once

**Sorting**

- `?sort=last_name` — alphabetical by last name
- `?sort=-id` — newest first
- `?sort=country` — group by country

**Filtering**

## Order Fulfillment

Create and manage order fulfillments with tracking information via the CloudCart REST JSON:API.

GET: `/order-fulfillment`, `/order-fulfillment/{id}`

**Include paths**

- `?include=order` — the parent order

**Sorting**

- `?sort=-date_fulfilled` — newest first
- `?sort=shipping_date_delivery` — by delivery date
- `?sort=order_id` — grouped by order

## Order Returns

Record partial or full order returns, track refunds, restock returned goods and issue credit notes via the CloudCart REST JSON:API.

GET: `/order-returns`, `/order-returns/{id}`

**Include paths**

- `?include=order`, the parent order

**Filtering and sorting**

| Filter | Type | Description |
| `filter[order_id]` | integer | Only returns of this order. |
| `filter[status]` | string | `pending`, `returned` or `cancelled` (an array is allowed). |
| `filter[return_type]` | string | `full` or `partial`. |

## Order Sub-Resources

Read-only resources for accessing order line items, payment, shipping, addresses, taxes, and totals.

GET: `/order-billing-address`, `/order-billing-address/{id}`, `/order-discount`, `/order-discount/{id}`, `/order-payment`, `/order-payment/{id}`, `/order-products`, `/order-products-options`, `/order-products-options/{id}`, `/order-products/{id}`, `/order-shipping`, `/order-shipping-address`, `/order-shipping-address/{id}`, `/order-shipping/{id}`, `/order-tax`, `/order-tax/{id}`, `/order-total`, `/order-total/{id}`

**Sorting**

**Filtering**

| Filter | Description |
| `filter[start_date]` | Payments on or after this date. |
| `filter[end_date]` | Payments on or before this date. |

**Filter payments by date range**

## Orders

Retrieve and update orders in your CloudCart store via the REST JSON:API.

GET: `/order-status`, `/orders`, `/orders/{id}`

**Include paths**

- `?include=products` — order line items
- `?include=products.options` — line items with their selected options
- `?include=payment` — payment transaction details
- `?include=discounts` — applied discount codes
- `?include=totals` — order total breakdown
- `?include=taxes` — tax line items
- `?include=shipping.provider` — shipping method with its provider details
- `?include=shipping-address` — delivery address
- `?include=billing-address` — billing address
- `?include=products,payment,shipping-address` — combine multiple includes

**Appended attributes**

- `?append[orders]=meta` — order meta information (custom fields, additional data)

**Sorting**

- `?sort=-date_added` — newest first
- `?sort=id` — oldest first (by ID)
- `?sort=-updated_at` — recently updated first
- `?sort=date_archived` — by archive date

**Filtering**

| Filter | Description |
| `filter[start_date]` | Orders placed on or after this date (filters on `date_added`). |
| `filter[end_date]` | Orders placed on or before this date (filters on `date_added`). |
| `filter[geo_zone_id]` | Filter by geographic zone ID. |
| `filter[geo_zone_name]` | Filter by geographic zone name. |

**Filter orders by date range**

## Categories

Manage product categories — create, update, list, and delete.

GET: `/categories`, `/categories/{id}`

**Include paths**

- `?include=properties` — category properties
- `?include=properties.options` — properties with their option values

**Appended attributes**

- `?append[categories]=image_url` — CDN URL of the category image

**Sorting**

- `?sort=name` — A to Z
- `?sort=-created_at` — newest first
- `?sort=order` — manual position

**Filtering**

| Filter | Description |
| `filter[url_handle]` | Look up by slug. Returns a **single object**, not an array. |

## Images

Upload and manage product images — create, list, and delete.

GET: `/images`, `/images/{id}`

**Sorting**

- `?sort=sort_order` — display order
- `?sort=-date_added` — newest first
- `?sort=name` — alphabetical

## Product Options

Retrieve custom product options from the Product Options app.

GET: `/product-options`, `/product-options/{id}`

## Products

Manage products in your CloudCart store — create, update, list, and delete.

GET: `/products`, `/products/{id}`

**Include paths**

- `?include=variants` — all variants
- `?include=variants,images` — variants and images
- `?include=variants.images` — variants with their images (nested)
- `?include=property-options` — product property values
- `?include=property-options.property` — property values with their parent property definitions
- `?include=product-to-discount` — discount associations

**Appended attributes**

- `?append[products]=meta` — SEO and meta information
- `?append[products]=discount` — current discount info
- `?append[products]=meta,discount` — both at once

- `?append[variants]=discount` — discount info per variant

**Sorting**

- `?sort=name` — A to Z
- `?sort=-date_added` — newest first
- `?sort=-views` — most viewed first

**Filtering**

| Filter | Description |
| `filter[sku]` | Match by variant SKU. |
| `filter[barcode]` | Match by variant barcode. |
| `filter[property_id]` | Filter products that have a specific [property](/docs/rest-api/products/categories) assigned. |
| `filter[property_option_id]` | Filter products by a specific property option value (e.g. "Cotton", "Leather"). |
| `filter[url_handle]` | Look up by slug. Returns a **single object**, not an array. |

## Property Options API

Create, update, list, and delete property option values (Cotton, Polyester) within product properties.

GET: `/property-options`, `/property-options/{id}`

**Include paths**

- `?include=property` — the parent property

**Sorting**

- `?sort=value` — A to Z
- `?sort=-value` — Z to A
- `?sort=-created_at` — newest first

**Filtering**

| Filter | Description |
| `filter[parameter_id]` | List options for a specific property. |

## Properties API

Create, update, list, and delete product properties — structured attributes for filtering and descriptions.

GET: `/properties`, `/properties/{id}`

**Include paths**

- `?include=options` — property options (the selectable values)
- `?append[properties]=display_type` — include the display type in the response

**Sorting**

- `?sort=name` — A to Z
- `?sort=-name` — Z to A
- `?sort=-created_at` — newest first

## Variant Options

Manage variant option values (S, M, L or Red, Blue) within variant parameters.

GET: `/variant-options`, `/variant-options/{id}`

**Include paths**

- `?include=parameter` — the parent variant parameter

**Filtering**

## Variant Parameters

Manage variant parameters (Size, Color, Material) that define how product variants differ.

GET: `/variant-parameters`, `/variant-parameters/{id}`

**Appended attributes**

| Field | Type | Description |
| `display_type` | string | The display type value for this parameter. |

**Include paths**

- `?include=options` — all option values for this parameter

## Variants API

Create, update, list, and delete product variants — the purchasable items with pricing and inventory.

GET: `/variants`, `/variants/{id}`

**Appended attributes**

| Field | Type | Description |
| `unit_name` | string | Display name of the unit of measure. |
| `unit_short_name` | string | Short unit label (e.g. `"kg"`). |
| `unit_value_formatted` | string | Formatted unit value with label. |

**Include paths**

- `?include=images` — variant images
- `?include=option1,option2,option3` — all option values
- `?include=option1.parameter` — option value with its parent parameter definition
- `?include=option2.parameter,option3.parameter` — multiple nested includes

**Sorting**

- `?sort=price` — cheapest first
- `?sort=-price` — most expensive first
- `?sort=-quantity` — most stock first

**Filtering**

| Filter | Description |
| `filter[has_images]` | Only variants that have associated images. |

## Vendors

Manage product vendors and brands — create, update, list, and delete.

GET: `/vendors`, `/vendors/{id}`

**Sorting**

- `?sort=name` — A to Z
- `?sort=-name` — Z to A
- `?sort=-created_at` — newest first

**Filtering**

| Filter | Description |
| `filter[url_handle]` | Look up by slug. Returns a **single object**, not an array. |

## Payment Providers

Retrieve payment providers configured in your CloudCart store via the REST JSON:API.

GET: `/payment-providers`, `/payment-providers/{id}`

**Filtering**

| Filter | Description |
| `filter[active]` | Filter by active status (`1` or `0`). |

- `?filter[active]=1` — only active (enabled) payment providers
- `?filter[active]=0` — only disabled payment providers

## Redirects

Manage URL redirects in your CloudCart store — create, update, list, and delete.

GET: `/redirects`, `/redirects/{id}`

**Sorting**

- `?sort=redirect_type` — group by redirect type
- `?sort=item_type` — group by target resource type
- `?sort=-item_id` — by target resource ID, descending

**Filtering**

## Shipping Providers

Retrieve shipping providers configured in your CloudCart store via the REST JSON:API.

GET: `/shipping-providers`, `/shipping-providers/{id}`

**Filtering**

## Store Quantity

Manage per-store inventory quantities for products and variants.

GET: `/store-quantity`, `/store-quantity/{id}`

**Sorting**

- `?sort=-qty` — highest stock first
- `?sort=product_id` — group by product
- `?sort=shop_id` — group by store

## Stores

Retrieve store locations for multi-location inventory management.

GET: `/stores`, `/stores/{id}`

**Sorting**

- `?sort=title` — alphabetical by name
- `?sort=-active` — active stores first
- `?sort=city` — alphabetical by city

**Filtering**

| Filter | Description |
| `filter[url_handle]` | Look up by slug. Returns a **single object**, not an array. |

## Units

Retrieve measurement units for the Grocery Store app.

GET: `/units`, `/units/{id}`

**Include paths**

- `?include=parent` -- load the parent unit inline

**Sorting**


