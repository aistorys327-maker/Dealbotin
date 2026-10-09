/**
 * lib/gemini.js
 * AI caption generation using Google Gemini (gemini-3.8-flash) via @google/genai SDK.
 * Generates catchy 2-line Hinglish captions with emojis and strictly no false claims.
 * Gracefully falls back to clean templates when GEMINI_API_KEY is not configured or on failure.
 */

import { GoogleGenAI } from '@google/genai';

/**
 * Returns a clean, attractive default Hinglish caption template
 */
export function getDefaultCaption(deal) {
  const storeEmoji = deal.source === 'amazon' ? '📦 Amazon' : '🛍️ Flipkart';
  return `🔥 *Loot Deal Alert!* Flat ${deal.discount}% OFF on ${deal.brand ? deal.brand.toUpperCase() : 'this top pick'}!\n⚡ Limited time lightning deal, stock khatam hone se pehle grab karo!`;
}

/**
 * Generates an engaging Hinglish caption using Gemini 3.8 Flash
 * @param {object} deal - Normalized deal object
 * @returns {Promise<string>} 2-line Hinglish caption
 */
export async function generateCaption(deal) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return getDefaultCaption(deal);
  }

  try {
    const ai = new GoogleGenAI({ apiKey });

    const prompt = `You are a social media deal expert writing short Telegram channel captions for Indian shoppers.
Write a 2-line catchy caption in natural Hinglish (Hindi + English mix) with vibrant emojis for this deal:
Product: ${deal.title}
Brand: ${deal.brand || 'Popular'}
Current Deal Price: ₹${deal.price}
Original MRP: ₹${deal.mrp}
Discount: ${deal.discount}% OFF
Platform: ${deal.source.toUpperCase()}

RULES:
1. Exactly 1 or 2 lines maximum.
2. Natural, enthusiastic Hinglish (e.g. "Bhaari discount", "Loot offer", "Jaldi grab karo").
3. Include 2-3 relevant emojis (🔥, ⚡, 💥, 🏷️).
4. STRICT: No false claims, no misleading promo codes, no "Free me mil raha hai" claims.
5. Return ONLY the 1-2 line caption text. Do not include markdown code blocks or quotes.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt
    });

    const captionText = response.text ? response.text.trim() : '';

    if (captionText && captionText.length > 10) {
      // Ensure max 2 lines
      const lines = captionText.split('\n').filter(l => l.trim().length > 0).slice(0, 2);
      return lines.join('\n');
    }

    return getDefaultCaption(deal);
  } catch (err) {
    console.warn('[gemini] Gemini caption generation failed, falling back to template:', err.message);
    return getDefaultCaption(deal);
  }
}
