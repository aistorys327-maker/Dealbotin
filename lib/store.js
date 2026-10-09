/**
 * lib/store.js
 * Persistent storage layer powered by Netlify Blobs.
 * Includes graceful local fallback (file/memory) for local development outside Netlify.
 */

import { getStore } from '@netlify/blobs';
import fs from 'node:fs';
import path from 'node:path';

const STORE_NAME = 'deals-bot';
const CACHE_DIR = path.resolve(process.cwd(), '.cache');
const LOCAL_STORE_FILE = path.join(CACHE_DIR, 'deals-store.json');

// Default initial settings
export const DEFAULT_SETTINGS = {
  keywords: [
    'smartphone',
    'headphones',
    'smartwatch',
    'laptop',
    'sneakers',
    'tws earbuds',
    'air fryer',
    'power bank'
  ],
  minDiscount: 40,
  maxPostsPerRun: 5,
  quietHours: {
    enabled: false,
    startHourIST: 23, // 11 PM IST
    endHourIST: 7     // 7 AM IST
  }
};

// 48 hours TTL in milliseconds for deduplication
const DEDUPE_TTL_MS = 48 * 60 * 60 * 1000;
const MAX_HISTORY_ITEMS = 200;
const MAX_LOG_ITEMS = 50;

/**
 * In-memory / file cache helper for local dev
 */
let localMemoryState = null;

function loadLocalState() {
  if (localMemoryState) return localMemoryState;
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    if (fs.existsSync(LOCAL_STORE_FILE)) {
      const data = fs.readFileSync(LOCAL_STORE_FILE, 'utf-8');
      localMemoryState = JSON.parse(data);
      return localMemoryState;
    }
  } catch (err) {
    console.warn('[store] Local cache read warning:', err.message);
  }

  localMemoryState = {
    settings: { ...DEFAULT_SETTINGS },
    dedupe: {}, // hash -> timestamp
    history: [],
    logs: []
  };
  return localMemoryState;
}

function saveLocalState() {
  if (!localMemoryState) return;
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    fs.writeFileSync(LOCAL_STORE_FILE, JSON.stringify(localMemoryState, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[store] Local cache write warning:', err.message);
  }
}

/**
 * Obtain Netlify Blob store instance if available
 */
function getBlobStore() {
  try {
    // Netlify Blobs works automatically in Netlify Functions runtime
    return getStore({ name: STORE_NAME, consistency: 'strong' });
  } catch (err) {
    return null;
  }
}

/**
 * Generic getter: tries Netlify Blobs first, falls back to local storage
 */
async function getStoredJson(key, defaultValue) {
  const store = getBlobStore();
  if (store) {
    try {
      const data = await store.get(key, { type: 'json' });
      if (data !== null && data !== undefined) {
        return data;
      }
    } catch (err) {
      // Blobs might not be configured in local dev, fall back gracefully
    }
  }

  const localState = loadLocalState();
  return localState[key] !== undefined ? localState[key] : defaultValue;
}

/**
 * Generic setter: writes to Netlify Blobs and local cache
 */
async function setStoredJson(key, value) {
  const store = getBlobStore();
  let writtenToBlob = false;
  if (store) {
    try {
      await store.setJSON(key, value);
      writtenToBlob = true;
    } catch (err) {
      // fallback
    }
  }

  // Always update local cache as well
  const localState = loadLocalState();
  localState[key] = value;
  saveLocalState();
  return writtenToBlob;
}

/**
 * Settings methods
 */
export async function getSettings() {
  const settings = await getStoredJson('settings', DEFAULT_SETTINGS);
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    quietHours: {
      ...DEFAULT_SETTINGS.quietHours,
      ...(settings?.quietHours || {})
    }
  };
}

export async function saveSettings(newSettings) {
  const current = await getSettings();
  const updated = {
    keywords: Array.isArray(newSettings.keywords) ? newSettings.keywords : current.keywords,
    minDiscount: typeof newSettings.minDiscount === 'number' ? Math.max(0, Math.min(99, newSettings.minDiscount)) : current.minDiscount,
    maxPostsPerRun: typeof newSettings.maxPostsPerRun === 'number' ? Math.max(1, Math.min(25, newSettings.maxPostsPerRun)) : current.maxPostsPerRun,
    quietHours: {
      enabled: typeof newSettings?.quietHours?.enabled === 'boolean' ? newSettings.quietHours.enabled : current.quietHours.enabled,
      startHourIST: typeof newSettings?.quietHours?.startHourIST === 'number' ? newSettings.quietHours.startHourIST : current.quietHours.startHourIST,
      endHourIST: typeof newSettings?.quietHours?.endHourIST === 'number' ? newSettings.quietHours.endHourIST : current.quietHours.endHourIST
    }
  };
  await setStoredJson('settings', updated);
  return updated;
}

/**
 * Deduplication methods
 * Store a hash of product id + price; do not repost same product at same price within 48 hours.
 */
export async function isDuplicate(dealHash) {
  const dedupeMap = await getStoredJson('dedupe', {});
  const lastSeen = dedupeMap[dealHash];
  if (!lastSeen) return false;

  const age = Date.now() - Number(lastSeen);
  if (age < DEDUPE_TTL_MS) {
    return true; // Still within 48h duplicate window
  }
  return false;
}

export async function recordPostedDeal(deal, dealHash) {
  const now = Date.now();

  // 1. Update dedupe map & purge entries older than 48 hours
  const dedupeMap = await getStoredJson('dedupe', {});
  dedupeMap[dealHash] = now;
  for (const [hash, timestamp] of Object.entries(dedupeMap)) {
    if (now - Number(timestamp) > DEDUPE_TTL_MS) {
      delete dedupeMap[hash];
    }
  }
  await setStoredJson('dedupe', dedupeMap);

  // 2. Prepend to history (last 200 posts)
  const history = await getStoredJson('history', []);
  const postEntry = {
    id: deal.id,
    dealHash,
    title: deal.title,
    image: deal.image,
    price: deal.price,
    mrp: deal.mrp,
    discount: deal.discount,
    link: deal.link,
    source: deal.source,
    caption: deal.caption || '',
    postedAt: new Date().toISOString()
  };
  const updatedHistory = [postEntry, ...history.filter(h => h.dealHash !== dealHash)].slice(0, MAX_HISTORY_ITEMS);
  await setStoredJson('history', updatedHistory);

  return postEntry;
}

/**
 * Post history query
 */
export async function getHistory(limit = 100) {
  const history = await getStoredJson('history', []);
  return history.slice(0, limit);
}

/**
 * Run logs methods (last 50 runs)
 */
export async function recordRunLog(logEntry) {
  const logs = await getStoredJson('logs', []);
  const entry = {
    id: `run_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    timestamp: new Date().toISOString(),
    ...logEntry
  };
  const updatedLogs = [entry, ...logs].slice(0, MAX_LOG_ITEMS);
  await setStoredJson('logs', updatedLogs);
  return entry;
}

export async function getLogs(limit = 50) {
  const logs = await getStoredJson('logs', []);
  return logs.slice(0, limit);
}

/**
 * Overall system status overview
 */
export async function getStatus() {
  const logs = await getLogs(1);
  const history = await getHistory(1);
  const settings = await getSettings();

  const lastRun = logs[0] || null;
  const lastPost = history[0] || null;

  // Check IST Quiet Hours status
  const now = new Date();
  const utcHours = now.getUTCHours();
  const utcMinutes = now.getUTCMinutes();
  const istMinutesTotal = (utcHours * 60 + utcMinutes + 330) % (24 * 60);
  const currentISTHour = Math.floor(istMinutesTotal / 60);

  let isQuietHourNow = false;
  if (settings.quietHours?.enabled) {
    const { startHourIST, endHourIST } = settings.quietHours;
    if (startHourIST > endHourIST) {
      // e.g. 23 (11pm) to 7 (7am)
      isQuietHourNow = currentISTHour >= startHourIST || currentISTHour < endHourIST;
    } else {
      isQuietHourNow = currentISTHour >= startHourIST && currentISTHour < endHourIST;
    }
  }

  return {
    configuredServices: {
      telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHANNEL_ID),
      amazon: Boolean(process.env.AMAZON_PARTNER_TAG && process.env.AMAZON_ACCESS_KEY && process.env.AMAZON_SECRET_KEY),
      flipkart: Boolean(process.env.FLIPKART_AFFILIATE_ID && process.env.FLIPKART_AFFILIATE_TOKEN),
      gemini: Boolean(process.env.GEMINI_API_KEY),
      facebook: Boolean(process.env.FB_PAGE_ID && process.env.FB_PAGE_TOKEN),
      adminPasswordSet: Boolean(process.env.ADMIN_PASSWORD)
    },
    settings,
    currentISTTime: `${String(currentISTHour).padStart(2, '0')}:${String(istMinutesTotal % 60).padStart(2, '0')} IST`,
    isQuietHourNow,
    lastRun,
    lastPostTime: lastPost ? lastPost.postedAt : null,
    totalPostsRecorded: (await getHistory(MAX_HISTORY_ITEMS)).length
  };
}
