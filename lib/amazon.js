/**
 * lib/amazon.js
 * Amazon India PA-API 5.0 client with AWS Signature Version 4.
 * Integrates directly with marketplace: www.amazon.in (Region: eu-west-1).
 * Gracefully skips if credentials are not configured.
 */

import crypto from 'node:crypto';
import { normalizeDeal } from './filter.js';

const HOST = 'webservices.amazon.in';
const REGION = 'eu-west-1'; // Amazon PA-API 5.0 standard region for India
const SERVICE = 'ProductAdvertisingAPI';
const MARKETPLACE = 'www.amazon.in';

/**
 * Builds standard Amazon Affiliate link with associate partner tag
 */
export function buildAmazonAffiliateUrl(urlOrAsin, partnerTag) {
  const tag = partnerTag || process.env.AMAZON_PARTNER_TAG || '';
  if (!tag) return urlOrAsin;

  if (urlOrAsin && urlOrAsin.startsWith('http')) {
    try {
      const u = new URL(urlOrAsin);
      u.searchParams.set('tag', tag);
      u.searchParams.set('linkCode', 'll1');
      return u.toString();
    } catch {
      return `${urlOrAsin}${urlOrAsin.includes('?') ? '&' : '?'}tag=${tag}&linkCode=ll1`;
    }
  }

  // If passed ASIN
  return `https://www.amazon.in/dp/${urlOrAsin}?tag=${tag}&linkCode=ll1`;
}

/**
 * AWS Signature Version 4 helper for Amazon PA-API 5.0
 */
function signAmazonRequest({ accessKey, secretKey, payload, dateIso, amzDate }) {
  const dateStamp = amzDate.substring(0, 8); // YYYYMMDD
  const canonicalUri = '/paapi5/searchitems';
  const canonicalQueryString = '';

  const payloadHash = crypto.createHash('sha256').update(payload).digest('hex');

  const canonicalHeaders = `content-encoding:amz-1.0\n` +
    `content-type:application/json; charset=utf-8\n` +
    `host:${HOST}\n` +
    `x-amz-date:${amzDate}\n` +
    `x-amz-target:com.amazon.paapi5.v1.ProductAdvertisingAPIv1.SearchItems\n`;

  const signedHeaders = 'content-encoding;content-type;host;x-amz-date;x-amz-target';

  const canonicalRequest = `POST\n${canonicalUri}\n${canonicalQueryString}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

  const algorithm = 'AWS4-HMAC-SHA256';
  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = `${algorithm}\n${amzDate}\n${credentialScope}\n${crypto.createHash('sha256').update(canonicalRequest).digest('hex')}`;

  // Key derivation
  function hmac(key, data) {
    return crypto.createHmac('sha256', key).update(data).digest();
  }
  const kDate = hmac('AWS4' + secretKey, dateStamp);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, SERVICE);
  const kSigning = hmac(kService, 'aws4_request');

  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  const authorizationHeader = `${algorithm} Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    authorization: authorizationHeader,
    amzDate,
    payloadHash
  };
}

/**
 * Fetch deals from Amazon India PA-API 5.0
 * @param {string[]} keywords - List of search keywords
 * @param {number} minDiscount - Minimum discount threshold %
 * @returns {Promise<Array>} Normalized deals
 */
export async function fetchAmazonDeals(keywords = [], minDiscount = 40) {
  const accessKey = process.env.AMAZON_ACCESS_KEY;
  const secretKey = process.env.AMAZON_SECRET_KEY;
  const partnerTag = process.env.AMAZON_PARTNER_TAG;

  if (!accessKey || !secretKey || !partnerTag) {
    console.log('[amazon] Amazon credentials missing (AMAZON_ACCESS_KEY / AMAZON_SECRET_KEY / AMAZON_PARTNER_TAG). Skipping Amazon search.');
    return [];
  }

  const selectedKeywords = keywords.length > 0 ? keywords : ['electronics deals', 'smartphone offers'];
  const allDeals = [];

  // Query up to 2 representative keywords per run to stay well within Amazon rate limits (1 req/sec)
  const runKeywords = selectedKeywords.slice(0, 2);

  for (const keyword of runKeywords) {
    try {
      const now = new Date();
      const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // Format: 20261009T155536Z
      const dateIso = now.toISOString();

      const requestBody = JSON.stringify({
        Keywords: keyword,
        Resources: [
          'ItemInfo.Title',
          'ItemInfo.ByLineInfo',
          'Images.Primary.Large',
          'Offers.Listings.Price',
          'Offers.Listings.SavingBasis',
          'Offers.Listings.Promotions'
        ],
        SearchIndex: 'All',
        ItemCount: 10,
        MinSavingPercent: minDiscount,
        PartnerTag: partnerTag,
        PartnerType: 'Associates',
        Marketplace: MARKETPLACE
      });

      const { authorization } = signAmazonRequest({
        accessKey,
        secretKey,
        payload: requestBody,
        dateIso,
        amzDate
      });

      const response = await fetch(`https://${HOST}/paapi5/searchitems`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Encoding': 'amz-1.0',
          'X-Amz-Target': 'com.amazon.paapi5.v1.ProductAdvertisingAPIv1.SearchItems',
          'X-Amz-Date': amzDate,
          'Host': HOST,
          'Authorization': authorization
        },
        body: requestBody
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.warn(`[amazon] PA-API 5.0 returned HTTP ${response.status} for "${keyword}":`, errorText);
        continue;
      }

      const data = await response.json();
      const items = data?.SearchResult?.Items || [];

      for (const item of items) {
        const asin = item.ASIN;
        const title = item.ItemInfo?.Title?.DisplayValue;
        const brand = item.ItemInfo?.ByLineInfo?.Brand?.DisplayValue || '';
        const image = item.Images?.Primary?.Large?.URL;
        const listing = item.Offers?.Listings?.[0];

        const price = listing?.Price?.Amount;
        const mrp = listing?.SavingBasis?.Amount || price;
        const detailPageUrl = item.DetailPageURL || `https://www.amazon.in/dp/${asin}`;

        if (!title || !price || !image) continue;

        const normalized = normalizeDeal({
          id: asin,
          title,
          brand,
          image,
          price,
          mrp,
          link: buildAmazonAffiliateUrl(detailPageUrl, partnerTag),
          source: 'amazon'
        });

        if (normalized) {
          allDeals.push(normalized);
        }
      }
    } catch (err) {
      console.error(`[amazon] Error fetching keyword "${keyword}":`, err.message);
    }
  }

  return allDeals;
}
