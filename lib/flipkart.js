/**
 * lib/flipkart.js
 * Flipkart & Shopsy Affiliate API integration.
 * Fetches Deals of the Day (DOTD), Top Offers, and product search feeds.
 * Appends Flipkart affiliate tracking parameters (affid).
 * Gracefully skips if credentials are not configured.
 */

import { normalizeDeal } from './filter.js';

const DOTD_ENDPOINT = 'https://affiliate-api.flipkart.net/affiliate/offers/v1/dotd/json';
const TOP_OFFERS_ENDPOINT = 'https://affiliate-api.flipkart.net/affiliate/offers/v1/top/json';

/**
 * Appends Flipkart / Shopsy affiliate tracking ID to any product or offer URL
 */
export function buildFlipkartAffiliateUrl(url, affid) {
  const affiliateId = affid || process.env.FLIPKART_AFFILIATE_ID || '';
  if (!affiliateId || !url) return url;

  try {
    const u = new URL(url);
    u.searchParams.set('affid', affiliateId);
    return u.toString();
  } catch {
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}affid=${affiliateId}`;
  }
}

/**
 * Fetch deals from Flipkart Affiliate API
 * Covers both Flipkart and Shopsy promotions
 * @param {string[]} keywords - User configured keywords
 * @param {number} minDiscount - Minimum discount threshold %
 * @returns {Promise<Array>} Normalized deals
 */
export async function fetchFlipkartDeals(keywords = [], minDiscount = 40) {
  const affiliateId = process.env.FLIPKART_AFFILIATE_ID;
  const affiliateToken = process.env.FLIPKART_AFFILIATE_TOKEN;

  if (!affiliateId || !affiliateToken) {
    console.log('[flipkart] Flipkart credentials missing (FLIPKART_AFFILIATE_ID / FLIPKART_AFFILIATE_TOKEN). Skipping Flipkart search.');
    return [];
  }

  const deals = [];
  const headers = {
    'Fk-Affiliate-Id': affiliateId,
    'Fk-Affiliate-Token': affiliateToken,
    'Accept': 'application/json'
  };

  // 1. Fetch Deals of the Day (DOTD) feed
  try {
    const dotdRes = await fetch(DOTD_ENDPOINT, { headers });
    if (dotdRes.ok) {
      const data = await dotdRes.json();
      const dotdList = data?.dotdList || [];

      for (const item of dotdList) {
        const title = item.title || item.name || '';
        const image = item.imageUrls?.[0]?.url || item.imageUrl || '';
        const link = item.url || '';
        const id = item.url ? item.url.match(/pid=([^&]+)/)?.[1] || title.substring(0, 20) : title;

        // DOTD often has explicit discount percentage or title
        // e.g. "Min 50% Off on Top TWS Earbuds"
        let discount = 0;
        const discountMatch = title.match(/(\d+)%\s*off/i);
        if (discountMatch) {
          discount = parseInt(discountMatch[1], 10);
        }

        // Check if keyword matches any user-specified keywords
        const matchesKeyword = keywords.length === 0 || keywords.some(k => title.toLowerCase().includes(k.toLowerCase()));

        if (matchesKeyword && title && link) {
          const deal = normalizeDeal({
            id: `fk_dotd_${id}`,
            title,
            image,
            price: 499, // default indicator for offer banner if price not in feed
            mrp: 999,
            discount: discount || 50,
            link: buildFlipkartAffiliateUrl(link, affiliateId),
            source: 'flipkart'
          });
          if (deal) deals.push(deal);
        }
      }
    } else {
      console.warn(`[flipkart] DOTD endpoint returned HTTP ${dotdRes.status}`);
    }
  } catch (err) {
    console.error('[flipkart] Error fetching DOTD feed:', err.message);
  }

  // 2. Fetch keyword searches via Flipkart Search Feed
  const searchKeywords = (keywords.length > 0 ? keywords : ['smartwatch', 'earbuds']).slice(0, 2);

  for (const kw of searchKeywords) {
    try {
      const searchUrl = `https://affiliate-api.flipkart.net/affiliate/1.0/search.json?query=${encodeURIComponent(kw)}&resultCount=10`;
      const searchRes = await fetch(searchUrl, { headers });

      if (searchRes.ok) {
        const data = await searchRes.json();
        const productList = data?.products || data?.productInfoList || [];

        for (const item of productList) {
          const baseInfo = item.productBaseInfo?.productAttributes || item;
          const title = baseInfo.title || '';
          const id = baseInfo.productId || item.productId || '';
          const imageUrls = baseInfo.imageUrls || {};
          const image = imageUrls['800x800'] || imageUrls['400x400'] || imageUrls['200x200'] || Object.values(imageUrls)[0] || '';
          const link = baseInfo.productUrl || '';

          const price = baseInfo.sellingPrice?.amount || baseInfo.price;
          const mrp = baseInfo.maximumRetailPrice?.amount || baseInfo.mrp || price;

          if (title && price && image) {
            const deal = normalizeDeal({
              id: `fk_${id}`,
              title,
              brand: baseInfo.productBrand || '',
              image,
              price,
              mrp,
              link: buildFlipkartAffiliateUrl(link, affiliateId),
              source: link.includes('shopsy') ? 'shopsy' : 'flipkart'
            });
            if (deal) deals.push(deal);
          }
        }
      }
    } catch (err) {
      console.error(`[flipkart] Error searching query "${kw}":`, err.message);
    }
  }

  return deals;
}
