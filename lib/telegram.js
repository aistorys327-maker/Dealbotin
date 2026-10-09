/**
 * lib/telegram.js
 * Telegram Bot API client for broadcasting affiliate deals.
 * Implements sendPhoto with HTML captions, inline buy buttons, rate limit avoidance,
 * statutory affiliate disclosure, and automatic retry handling.
 */

const TELEGRAM_API_BASE = 'https://api.telegram.org';

/**
 * Escapes HTML characters for Telegram HTML parse mode
 */
export function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Formats full HTML caption for a deal
 */
export function formatDealCaption(deal, hinglishLead) {
  const cleanTitle = escapeHtml(deal.title.length > 120 ? deal.title.substring(0, 117) + '...' : deal.title);
  const cleanLead = escapeHtml(hinglishLead || '').trim();
  const sourceName = deal.source === 'amazon' ? 'Amazon.in' : deal.source === 'shopsy' ? 'Shopsy' : 'Flipkart';

  const parts = [];

  if (cleanLead) {
    parts.push(`<b>${cleanLead}</b>\n`);
  }

  parts.push(`🛍️ <b>${cleanTitle}</b>`);
  parts.push(`💰 <b>Deal Price:</b> ₹${deal.price.toLocaleString('en-IN')}  <s>₹${deal.mrp.toLocaleString('en-IN')}</s>`);
  parts.push(`🏷️ <b>Discount:</b> ${deal.discount}% OFF 🔥`);
  parts.push(`📦 <b>Store:</b> ${sourceName}`);
  parts.push(`\nℹ️ <i>Affiliate link: we may earn a commission.</i>`);

  return parts.join('\n');
}

/**
 * Sends a single photo with deal caption and inline "Buy Now" button to Telegram
 * @param {object} deal - Normalized deal object
 * @param {string} hinglishLead - 1-2 line Hinglish teaser
 * @param {number} maxRetries - Max retry attempts on transient network or 429 rate limit
 */
export async function postDealToTelegram(deal, hinglishLead = '', maxRetries = 2) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHANNEL_ID;

  if (!token || !chatId) {
    console.log('[telegram] Telegram credentials missing (TELEGRAM_BOT_TOKEN / TELEGRAM_CHANNEL_ID). Skipping Telegram post.');
    return { success: false, skipped: true, reason: 'Credentials missing' };
  }

  const caption = formatDealCaption(deal, hinglishLead);
  const inlineKeyboard = {
    inline_keyboard: [
      [
        {
          text: `🛒 Buy Now on ${deal.source === 'amazon' ? 'Amazon' : 'Flipkart'} ⚡`,
          url: deal.link
        }
      ]
    ]
  };

  const payload = {
    chat_id: chatId,
    photo: deal.image,
    caption,
    parse_mode: 'HTML',
    reply_markup: JSON.stringify(inlineKeyboard)
  };

  let attempt = 0;
  while (attempt <= maxRetries) {
    try {
      const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (data.ok) {
        return { success: true, messageId: data.result?.message_id, caption };
      }

      // Check Telegram 429 Too Many Requests
      if (response.status === 429 || data.error_code === 429) {
        const retryAfter = (data.parameters?.retry_after || 3) * 1000;
        console.warn(`[telegram] Rate limited. Waiting ${retryAfter}ms before retry...`);
        await new Promise(res => setTimeout(res, retryAfter));
        attempt++;
        continue;
      }

      // Check if image URL failed (e.g. invalid format or blocked image host)
      // Fallback: send as text message with photo link
      if (data.description && data.description.includes('photo')) {
        console.warn('[telegram] Image failed to send directly. Falling back to sendMessage with image link...');
        const textPayload = {
          chat_id: chatId,
          text: `<a href="${deal.image}">&#8205;</a>${caption}`,
          parse_mode: 'HTML',
          reply_markup: JSON.stringify(inlineKeyboard)
        };
        const textRes = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(textPayload)
        });
        const textData = await textRes.json();
        if (textData.ok) {
          return { success: true, messageId: textData.result?.message_id, caption };
        }
      }

      console.error(`[telegram] sendPhoto error attempt ${attempt}:`, data.description);
    } catch (err) {
      console.error(`[telegram] Network error attempt ${attempt}:`, err.message);
    }

    attempt++;
    if (attempt <= maxRetries) {
      await new Promise(res => setTimeout(res, 2000 * attempt));
    }
  }

  return { success: false, reason: 'Failed after retries' };
}

/**
 * Sends a test verification message to the configured Telegram channel
 */
export async function sendTelegramTest() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHANNEL_ID;

  if (!token || !chatId) {
    throw new Error('TELEGRAM_BOT_TOKEN and TELEGRAM_CHANNEL_ID environment variables must be configured.');
  }

  const messageText = `🤖 <b>DealsBot Connection Test</b>\n\n` +
    `✅ Your Telegram Bot and Channel connection is working successfully!\n` +
    `⏰ Timestamp: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST\n\n` +
    `<i>Automated deal notifications will appear in this channel every 30 minutes.</i>\n` +
    `ℹ️ <i>Affiliate link: we may earn a commission.</i>`;

  const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: messageText,
      parse_mode: 'HTML'
    })
  });

  const data = await response.json();
  if (!data.ok) {
    throw new Error(data.description || 'Failed to send message to Telegram channel');
  }

  return {
    success: true,
    messageId: data.result?.message_id,
    channel: chatId
  };
}
