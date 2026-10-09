/**
 * netlify/functions/scheduled-deals.js
 * Netlify Scheduled Function running every 30 minutes.
 * Automatically runs the deals engine, checks quiet hours, fetches, filters,
 * deduplicates via Netlify Blobs, formats Hinglish captions, and posts deals to Telegram/Facebook.
 */

import { runDealsEngine } from '../../lib/engine.js';

export default async function handler(req, context) {
  console.log('[scheduled-deals] Netlify 30-minute cron triggered');
  try {
    const result = await runDealsEngine({ force: false });
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('[scheduled-deals] Unhandled exception:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Scheduled to run every 30 minutes
export const config = {
  schedule: '*/30 * * * *'
};
