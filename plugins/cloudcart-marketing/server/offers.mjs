// Active public discounts, as the store reports them. A discounted price lives on a variant as a
// "discount" row with the new price and the saving; the row carries its parent discount campaign.
// Customer-group and code-only discounts are not public offers and are ignored.

const today = () => new Date().toISOString().slice(0, 10);

function isPublicRow(row) {
  const d = row?.discount || {};
  if (String(row?.active) !== '1' || (d.active !== undefined && d.active !== 'yes')) return false;
  if (row.customer_group_id || d.customer_group_id || d.code || String(d.only_customer) === '1') return false;
  const start = String(row.date_start || d.date_start || '').slice(0, 10);
  const end = String(row.date_end || d.date_end || '').slice(0, 10);
  if (start && start > today()) return false;
  if (end && end < today()) return false;
  return Number(row.price) > 0 && Number(row.save) > 0;
}

const money = (cents, sample) => {
  const text = (cents / 100).toFixed(2);
  // Follow the store's own formatting ("7,62 €") when a formatted sample is available.
  if (typeof sample === 'string' && /\d/.test(sample)) return sample.replace(/\d[\d.,\s]*\d|\d/, sample.includes(',') ? text.replace('.', ',') : text);
  return text;
};

/**
 * The offer on a product from its variants (each with attributes.discount = rows), or null.
 * With several discounted variants the cheapest one is used and `variants_differ` is set.
 */
export function offerFromVariants(variants) {
  const offers = [];
  for (const v of variants || []) {
    const rows = (Array.isArray(v.attributes?.discount) ? v.attributes.discount : []).filter(isPublicRow);
    if (!rows.length) continue;
    const row = rows.sort((a, b) => a.price - b.price)[0];
    const now = Number(row.price);
    const old = now + Number(row.save);
    offers.push({
      old_price: old / 100,
      new_price: now / 100,
      save: Number(row.save) / 100,
      percent: Math.round((Number(row.save) / old) * 100),
      old_price_text: money(old, row.price_formatted),
      new_price_text: money(now, row.price_formatted),
      ends: String(row.date_end || row.discount?.date_end || '').slice(0, 10) || null,
      campaign: row.discount?.name || null,
    });
  }
  if (!offers.length) return null;
  offers.sort((a, b) => a.new_price - b.new_price);
  const distinct = new Set(offers.map((o) => `${o.old_price}/${o.new_price}`)).size;
  return { ...offers[0], ...(distinct > 1 ? { variants_differ: true } : {}) };
}

const PRICE_RE = /(\d{1,5}(?:[.,]\d{2})?)\s?(€|eur\b|euro\b|лв\.?|bgn\b|\$)/giu;
const CUT_RE = /[-−–]\s?(\d{1,2})\s?%/gu;

/**
 * Check that every price and every "-N%" in the texts is one the store actually has.
 * products: [{ name, price_from, price_to, offer }]. Returns issues[].
 */
export function checkPrices(texts, products) {
  const allowedPrices = new Set();
  const allowedCuts = new Set();
  const add = (n) => typeof n === 'number' && allowedPrices.add(n.toFixed(2));
  for (const p of products) {
    add(p.price_from);
    add(p.price_to);
    if (p.offer) {
      add(p.offer.old_price);
      add(p.offer.new_price);
      add(p.offer.save);
      allowedCuts.add(p.offer.percent);
      allowedCuts.add(Math.floor((p.offer.save / p.offer.old_price) * 100));
    }
  }
  const anyOffer = products.some((p) => p.offer);
  const issues = [];
  const seen = new Set();
  for (const text of texts) {
    for (const m of String(text).matchAll(PRICE_RE)) {
      const value = parseFloat(m[1].replace(',', '.')).toFixed(2);
      if (allowedPrices.has(value) || seen.has(m[0])) continue;
      seen.add(m[0]);
      issues.push({
        severity: 'major', area: 'claims',
        problem: `The price "${m[0]}" is not a price the store has for ${products.length === 1 ? 'this product' : 'these products'}.`,
        fix: `Use only the store's prices: ${[...allowedPrices].join(', ') || 'none are known, so leave prices out'}.`,
      });
    }
    for (const m of String(text).matchAll(CUT_RE)) {
      const n = Number(m[1]);
      if (allowedCuts.has(n) || seen.has(m[0])) continue;
      seen.add(m[0]);
      issues.push({
        severity: 'major', area: 'claims',
        problem: anyOffer ? `The discount "${m[0]}" does not match the store's offer.` : `"${m[0]}" claims a discount, but the store has no active public discount on ${products.length === 1 ? 'this product' : 'these products'}.`,
        fix: anyOffer ? `The real discount is -${[...allowedCuts][0]}%.` : 'Remove the discount claim.',
      });
    }
  }
  return issues;
}
