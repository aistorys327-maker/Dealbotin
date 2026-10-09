/**
 * lib/filter.js
 * Normalizes, validates, filters, and hashes deal candidates.
 */

import crypto from 'node:crypto';

// Known reputable brands for the "trust rule" (allows legitimate price drops / loot deals < ₹100 or > 90% off)
const TRUSTED_BRANDS = new Set([
  'boat', 'noise', 'apple', 'samsung', 'oneplus', 'realme', 'xiaomi', 'redmi',
  'sony', 'philips', 'fastrack', 'titan', 'hp', 'lenovo', 'asus', 'acer', 'dell',
  'logitech', 'sandisk', 'zebronics', 'boult', 'ptron', 'mivi', 'fire-boltt',
  'ambrane', 'portronics', 'puma', 'nike', 'adidas', 'campus', 'sparks', 'casio'
]);

/**
 * Normalizes raw deal into uniform schema
 */
export function normalizeDeal(raw) {
  if (!raw) return null;

  const title = (raw.title || raw.name || '').trim();
  const image = (raw.image || raw.imageUrl || raw.thumbnail || '').trim();
  const source = (raw.source || 'deals').toLowerCase();
  const link = (raw.link || raw.url || '').trim();
  const id = String(raw.id || raw.asin || raw.productId || '').trim();
  const brand = (raw.brand || '').toLowerCase().trim();

  let price = Number(raw.price);
  let mrp = Number(raw.mrp || raw.listPrice || raw.originalPrice || price);

  if (isNaN(price) || price <= 0) return null;
  if (isNaN(mrp) || mrp < price) {
    mrp = price;
  }

  // Calculate discount percentage accurately
  let discount = 0;
  if (mrp > price) {
    discount = Math.round(((mrp - price) / mrp) * 100);
  } else if (raw.discount) {
    discount = Math.round(Number(raw.discount));
  }

  return {
    id,
    title,
    image,
    price: Math.round(price),
    mrp: Math.round(mrp),
    discount,
    link,
    source,
    brand,
    rawCategory: raw.category || '',
    isTrusted: checkTrustRule({ brand, title, source })
  };
}

/**
 * Trust rule check:
 * Identifies if an ultra-cheap or 90%+ discount deal is from a reputable brand or verified source,
 * distinguishing genuine flash error loots from spam / junk accessories.
 */
export function checkTrustRule(deal) {
  const brandLower = (deal.brand || '').toLowerCase();
  const titleLower = (deal.title || '').toLowerCase();

  // Check known trusted brands
  for (const trusted of TRUSTED_BRANDS) {
    if (brandLower.includes(trusted) || titleLower.includes(trusted)) {
      return true;
    }
  }

  return false;
}

/**
 * Evaluates whether a deal satisfies all filter criteria
 * @param {object} deal - Normalized deal object
 * @param {object} settings - Bot configuration settings
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateDeal(deal, settings = {}) {
  const minDiscount = typeof settings.minDiscount === 'number' ? settings.minDiscount : 40;

  // 1. Must have valid title, image, price, and link
  if (!deal.title || deal.title.length < 5) {
    return { valid: false, reason: 'Title missing or too short' };
  }
  if (!deal.image || !deal.image.startsWith('http')) {
    return { valid: false, reason: 'Invalid or missing image URL' };
  }
  if (!deal.price || deal.price <= 0) {
    return { valid: false, reason: 'Invalid price' };
  }
  if (!deal.link || !deal.link.startsWith('http')) {
    return { valid: false, reason: 'Missing destination link' };
  }

  // 2. Minimum discount threshold
  if (deal.discount < minDiscount) {
    return { valid: false, reason: `Discount ${deal.discount}% is below minimum required (${minDiscount}%)` };
  }

  // 3. Ultra-high discount (>90%) or ultra-low price (< Rs 100)
  // Skip unless it matches trust rule (avoids fake stickers, bogus cables, or deceptive listing spam)
  if (deal.discount > 90 || deal.price < 100) {
    if (!deal.isTrusted) {
      return {
        valid: false,
        reason: `Flagged as high-risk pricing anomaly (Price: ₹${deal.price}, Discount: ${deal.discount}%) without verified brand trust`
      };
    }
  }

  return { valid: true };
}

/**
 * Generates unique deduplication hash for product + price
 * This ensures that if the price drops again later, it can qualify as a new deal,
 * but duplicate posts for the same product at the same price within 48h are blocked.
 */
export function generateDealHash(deal) {
  const payload = `${deal.source}:${deal.id}:${Math.round(deal.price)}`;
  return crypto.createHash('sha256').update(payload).digest('hex').substring(0, 24);
}
