/**
 * lib/facebook.js
 * Facebook Page Graph API client for broadcasting affiliate deals.
 * Automatically skipped if FB_PAGE_ID or FB_PAGE_TOKEN are not configured.
 */

const GRAPH_API_BASE = 'https://graph.facebook.com/v19.0';

/**
 * Posts deal image and caption to Facebook Page feed
 * @param {object} deal - Normalized deal object
 * @param {string} hinglishLead - Teaser line
 */
export async function postDealToFacebook(deal, hinglishLead = '') {
  const pageId = process.env.FB_PAGE_ID;
  const pageToken = process.env.FB_PAGE_TOKEN;

  if (!pageId || !pageToken) {
    // Optional integration skipped gracefully
    return { success: false, skipped: true, reason: 'Facebook credentials not configured' };
  }

  const captionText = [
    hinglishLead ? `${hinglishLead}\n` : '',
    `🔥 ${deal.title}`,
    `💰 Deal Price: ₹${deal.price.toLocaleString('en-IN')} (MRP: ₹${deal.mrp.toLocaleString('en-IN')})`,
    `🏷️ Discount: ${deal.discount}% OFF`,
    `🛒 Buy Now: ${deal.link}`,
    `\nAffiliate link: we may earn a commission.`
  ].filter(Boolean).join('\n');

  try {
    const endpoint = `${GRAPH_API_BASE}/${encodeURIComponent(pageId)}/photos`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: deal.image,
        caption: captionText,
        access_token: pageToken
      })
    });

    const data = await response.json();

    if (data.id || data.post_id) {
      return { success: true, postId: data.id || data.post_id };
    }

    console.warn('[facebook] Graph API returned error:', data.error?.message || data);
    return { success: false, reason: data.error?.message || 'Graph API error' };
  } catch (err) {
    console.error('[facebook] Error posting deal:', err.message);
    return { success: false, reason: err.message };
  }
}
