/**
 * lib/engine.js
 * Core Deals Engine orchestrator.
 * Handles quiet hours check, multi-source deal scraping, filtering, deduplication,
 * caption generation, multi-channel publishing, rate-limit spacing, and telemetry.
 */

import { getSettings, isDuplicate, recordPostedDeal, recordRunLog } from './store.js';
import { validateDeal, generateDealHash } from './filter.js';
import { fetchAmazonDeals } from './amazon.js';
import { fetchFlipkartDeals } from './flipkart.js';
import { generateCaption } from './gemini.js';
import { postDealToTelegram } from './telegram.js';
import { postDealToFacebook } from './facebook.js';

/**
 * Calculates current time in Indian Standard Time (IST)
 */
function getISTHour() {
  const now = new Date();
  const utcHours = now.getUTCHours();
  const utcMinutes = now.getUTCMinutes();
  const istMinutesTotal = (utcHours * 60 + utcMinutes + 330) % (24 * 60);
  return Math.floor(istMinutesTotal / 60);
}

/**
 * Checks if current time is within configured Quiet Hours (default 11pm - 7am IST)
 */
function isQuietHours(settings) {
  if (!settings.quietHours?.enabled) return false;

  const currentHour = getISTHour();
  const start = settings.quietHours.startHourIST ?? 23;
  const end = settings.quietHours.endHourIST ?? 7;

  if (start > end) {
    // Overnight window: e.g. 23 (11 PM) to 7 (7 AM)
    return currentHour >= start || currentHour < end;
  }
  return currentHour >= start && currentHour < end;
}

/**
 * Runs the deals workflow once
 * @param {object} options
 * @param {boolean} options.force - If true, bypasses quiet hours check (for manual admin trigger)
 */
export async function runDealsEngine({ force = false } = {}) {
  const startTime = Date.now();
  const runErrors = [];
  const runLogs = [];

  const log = (msg) => {
    console.log(`[engine] ${msg}`);
    runLogs.push(msg);
  };

  log(`Starting deals execution run at ${new Date().toISOString()} (force=${force})`);

  // 1. Load active settings from Blobs
  const settings = await getSettings();
  log(`Loaded settings: minDiscount=${settings.minDiscount}%, maxPosts=${settings.maxPostsPerRun}, keywords=[${settings.keywords.join(', ')}]`);

  // 2. Check Quiet Hours (unless manually forced)
  if (!force && isQuietHours(settings)) {
    const quietMsg = `Quiet hours active (${settings.quietHours.startHourIST}:00 - ${settings.quietHours.endHourIST}:00 IST). Skipping automated run.`;
    log(quietMsg);
    const summary = {
      status: 'SKIPPED_QUIET_HOURS',
      message: quietMsg,
      durationMs: Date.now() - startTime,
      dealsFound: 0,
      dealsFiltered: 0,
      dealsDeduplicated: 0,
      dealsPosted: 0,
      errors: [],
      logs: runLogs
    };
    await recordRunLog(summary);
    return summary;
  }

  // 3. Fetch deals from Amazon and Flipkart in separate try/catches
  let amazonRaw = [];
  let flipkartRaw = [];

  try {
    log('Querying Amazon.in PA-API 5.0...');
    amazonRaw = await fetchAmazonDeals(settings.keywords, settings.minDiscount);
    log(`Amazon returned ${amazonRaw.length} raw candidates`);
  } catch (err) {
    const errText = `Amazon fetch failure: ${err.message}`;
    console.error(`[engine] ${errText}`);
    runErrors.push(errText);
  }

  try {
    log('Querying Flipkart / Shopsy Affiliate feed...');
    flipkartRaw = await fetchFlipkartDeals(settings.keywords, settings.minDiscount);
    log(`Flipkart returned ${flipkartRaw.length} raw candidates`);
  } catch (err) {
    const errText = `Flipkart fetch failure: ${err.message}`;
    console.error(`[engine] ${errText}`);
    runErrors.push(errText);
  }

  const allRawDeals = [...amazonRaw, ...flipkartRaw];
  const dealsFoundCount = allRawDeals.length;

  if (dealsFoundCount === 0) {
    log('No deals found from configured sources. Check API credentials or keywords.');
    const summary = {
      status: runErrors.length > 0 ? 'WARNING' : 'NO_DEALS_FOUND',
      durationMs: Date.now() - startTime,
      dealsFound: 0,
      dealsFiltered: 0,
      dealsDeduplicated: 0,
      dealsPosted: 0,
      errors: runErrors,
      logs: runLogs
    };
    await recordRunLog(summary);
    return summary;
  }

  // 4. Validate & Filter deals
  const passedFilters = [];
  let filteredOutCount = 0;

  for (const deal of allRawDeals) {
    const validation = validateDeal(deal, settings);
    if (validation.valid) {
      passedFilters.push(deal);
    } else {
      filteredOutCount++;
      // log(`Filtered out "${deal.title}": ${validation.reason}`);
    }
  }

  log(`Passed filter validation: ${passedFilters.length} deals (Filtered out: ${filteredOutCount})`);

  // 5. Deduplicate using Netlify Blobs (48 hours window)
  const freshDeals = [];
  let dedupeCount = 0;

  for (const deal of passedFilters) {
    const hash = generateDealHash(deal);
    deal.dealHash = hash;

    const duplicate = await isDuplicate(hash);
    if (duplicate) {
      dedupeCount++;
      // log(`Skipping duplicate deal within 48h: ${deal.title}`);
    } else {
      freshDeals.push(deal);
    }
  }

  log(`Fresh non-duplicate deals: ${freshDeals.length} (Deduplicated: ${dedupeCount})`);

  // 6. Select top deals up to maxPostsPerRun (sort by highest discount first)
  freshDeals.sort((a, b) => b.discount - a.discount);
  const dealsToPost = freshDeals.slice(0, settings.maxPostsPerRun);
  const postedRecords = [];

  log(`Posting top ${dealsToPost.length} deals...`);

  // 7. Publish deals with rate-limit spacing
  for (let i = 0; i < dealsToPost.length; i++) {
    const deal = dealsToPost[i];
    try {
      log(`Processing deal [${i + 1}/${dealsToPost.length}]: "${deal.title}" (₹${deal.price}, ${deal.discount}% off)`);

      // Generate Hinglish caption with emojis via Gemini AI (or clean template)
      const hinglishCaption = await generateCaption(deal);
      deal.caption = hinglishCaption;

      // Post to Telegram
      const tgResult = await postDealToTelegram(deal, hinglishCaption);
      if (tgResult.success) {
        log(`Posted to Telegram channel successfully (MsgID: ${tgResult.messageId})`);
      } else if (tgResult.skipped) {
        log(`Telegram posting skipped: ${tgResult.reason}`);
      } else {
        log(`Telegram post failed: ${tgResult.reason}`);
        runErrors.push(`Telegram post error for "${deal.title}": ${tgResult.reason}`);
      }

      // Post to Facebook Page (if configured)
      const fbResult = await postDealToFacebook(deal, hinglishCaption);
      if (fbResult.success) {
        log(`Posted to Facebook Page successfully (PostID: ${fbResult.postId})`);
      }

      // Record posted deal in history and dedupe store
      const record = await recordPostedDeal(deal, deal.dealHash);
      postedRecords.push(record);

      // Delay between posts to respect Telegram rate limits (1.5s delay)
      if (i < dealsToPost.length - 1) {
        await new Promise(r => setTimeout(r, 1500));
      }
    } catch (err) {
      console.error(`[engine] Error processing deal "${deal.title}":`, err.message);
      runErrors.push(`Error on "${deal.title}": ${err.message}`);
    }
  }

  const durationMs = Date.now() - startTime;
  const status = runErrors.length > 0 ? (postedRecords.length > 0 ? 'PARTIAL_SUCCESS' : 'ERROR') : 'SUCCESS';

  const summary = {
    status,
    timestamp: new Date().toISOString(),
    durationMs,
    dealsFound: dealsFoundCount,
    dealsFiltered: filteredOutCount,
    dealsDeduplicated: dedupeCount,
    dealsPosted: postedRecords.length,
    postedDeals: postedRecords.map(p => ({ id: p.id, title: p.title, price: p.price, discount: p.discount, source: p.source })),
    errors: runErrors,
    logs: runLogs
  };

  await recordRunLog(summary);
  log(`Run completed in ${durationMs}ms with status: ${status}. Posted ${postedRecords.length} deals.`);

  return summary;
}
