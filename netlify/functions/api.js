/**
 * netlify/functions/api.js
 * Admin API HTTP Function for DealsBot Dashboard.
 * Protected by header 'x-admin-password' with constant-time comparison and rate limiting.
 */

import crypto from 'node:crypto';
import { getStatus, getSettings, saveSettings, getHistory, getLogs } from '../../lib/store.js';
import { runDealsEngine } from '../../lib/engine.js';
import { sendTelegramTest } from '../../lib/telegram.js';

// In-memory rate limiting tracker
const rateLimitMap = new Map(); // ip -> { count, resetAt, failedAuthCount }

/**
 * Basic IP-based rate limiter
 */
function checkRateLimit(clientIp) {
  const now = Date.now();
  let record = rateLimitMap.get(clientIp);

  if (!record || now > record.resetAt) {
    record = { count: 1, resetAt: now + 60000, failedAuthCount: 0 };
    rateLimitMap.set(clientIp, record);
    return { allowed: true };
  }

  record.count++;

  // Too many failed auths (max 6 per minute)
  if (record.failedAuthCount >= 6) {
    return { allowed: false, reason: 'Too many failed login attempts. Try again in a minute.' };
  }

  // Too many total requests (max 60 per minute)
  if (record.count > 60) {
    return { allowed: false, reason: 'Rate limit exceeded. Please wait a moment.' };
  }

  return { allowed: true };
}

function recordFailedAuth(clientIp) {
  const record = rateLimitMap.get(clientIp);
  if (record) {
    record.failedAuthCount = (record.failedAuthCount || 0) + 1;
  }
}

/**
 * Constant-time comparison between provided password and ADMIN_PASSWORD
 */
function verifyAdminPassword(providedPassword) {
  const expectedPassword = process.env.ADMIN_PASSWORD;

  if (!expectedPassword || expectedPassword.trim() === '') {
    // If ADMIN_PASSWORD is not set in environment, deny for security
    return { authorized: false, reason: 'ADMIN_PASSWORD is not configured in server environment.' };
  }

  if (!providedPassword) {
    return { authorized: false, reason: 'Missing x-admin-password header.' };
  }

  const providedBuffer = Buffer.from(String(providedPassword));
  const expectedBuffer = Buffer.from(String(expectedPassword));

  // Must have same length for timingSafeEqual
  if (providedBuffer.length !== expectedBuffer.length) {
    // Perform dummy timingSafeEqual to avoid timing side-channel
    crypto.timingSafeEqual(expectedBuffer, expectedBuffer);
    return { authorized: false, reason: 'Invalid admin password.' };
  }

  const matches = crypto.timingSafeEqual(providedBuffer, expectedBuffer);
  return matches ? { authorized: true } : { authorized: false, reason: 'Invalid admin password.' };
}

/**
 * Helper to return uniform JSON responses
 */
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, x-admin-password',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    }
  });
}

/**
 * Main Netlify Function Request Handler
 */
export default async function handler(req, context) {
  // Handle CORS Preflight
  if (req.method === 'OPTIONS') {
    return jsonResponse({ ok: true });
  }

  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown-client';
  const rateLimit = checkRateLimit(clientIp);
  if (!rateLimit.allowed) {
    return jsonResponse({ success: false, error: rateLimit.reason }, 429);
  }

  // Parse path & method
  const url = new URL(req.url);
  let pathname = url.pathname;

  // Normalize path if routed via /.netlify/functions/api/:splat or /api/:splat
  pathname = pathname.replace(/^\/\.netlify\/functions\/api/, '');
  pathname = pathname.replace(/^\/api/, '');
  if (!pathname.startsWith('/')) {
    pathname = `/${pathname}`;
  }

  const method = req.method.toUpperCase();

  // Validate admin authentication for all API operations
  const adminPassword = req.headers.get('x-admin-password');
  const authResult = verifyAdminPassword(adminPassword);

  if (!authResult.authorized) {
    recordFailedAuth(clientIp);
    return jsonResponse({
      success: false,
      error: authResult.reason
    }, 401);
  }

  try {
    // 1. GET /status & POST /auth-check
    if ((pathname === '/status' || pathname === '') && method === 'GET') {
      const status = await getStatus();
      return jsonResponse({ success: true, status });
    }

    if (pathname === '/auth-check' && (method === 'GET' || method === 'POST')) {
      const status = await getStatus();
      return jsonResponse({ success: true, message: 'Authenticated successfully', status });
    }

    // 2. GET /settings & POST /settings
    if (pathname === '/settings') {
      if (method === 'GET') {
        const settings = await getSettings();
        return jsonResponse({ success: true, settings });
      }

      if (method === 'POST') {
        let body = {};
        try {
          body = await req.json();
        } catch {
          return jsonResponse({ success: false, error: 'Invalid JSON payload' }, 400);
        }

        const updated = await saveSettings(body);
        return jsonResponse({
          success: true,
          message: 'Settings updated successfully',
          settings: updated
        });
      }
    }

    // 3. POST /run-now
    if (pathname === '/run-now' && method === 'POST') {
      console.log(`[api] Manual run triggered by admin from IP: ${clientIp}`);
      const runResult = await runDealsEngine({ force: true });
      return jsonResponse({
        success: true,
        message: 'Deals engine run completed',
        result: runResult
      });
    }

    // 4. POST /test-telegram
    if (pathname === '/test-telegram' && method === 'POST') {
      console.log(`[api] Test telegram triggered by admin`);
      try {
        const testResult = await sendTelegramTest();
        return jsonResponse({
          success: true,
          message: 'Test message sent to Telegram channel successfully!',
          result: testResult
        });
      } catch (err) {
        return jsonResponse({
          success: false,
          error: `Telegram test failed: ${err.message}`
        }, 400);
      }
    }

    // 5. GET /history
    if (pathname === '/history' && method === 'GET') {
      const history = await getHistory(200);
      const logs = await getLogs(50);
      return jsonResponse({
        success: true,
        history,
        logs
      });
    }

    return jsonResponse({ success: false, error: `Endpoint not found: ${method} ${pathname}` }, 404);
  } catch (err) {
    console.error(`[api] Error handling ${method} ${pathname}:`, err);
    return jsonResponse({ success: false, error: err.message }, 500);
  }
}
