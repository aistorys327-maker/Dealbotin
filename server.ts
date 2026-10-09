/**
 * server.ts
 * Local development and full-stack runtime server for Google AI Studio.
 * Runs on port 3000. Serves /public static assets and maps /api/* to Netlify Functions.
 */

import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import apiHandler from './netlify/functions/api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Set friendly development default password if not configured
if (!process.env.ADMIN_PASSWORD) {
  process.env.ADMIN_PASSWORD = 'admin';
  console.log('--------------------------------------------------');
  console.log('ℹ️  NOTICE: ADMIN_PASSWORD was not set in .env');
  console.log('🔑  Default temporary password set to: "admin"');
  console.log('    Use "admin" to log in to the preview dashboard.');
  console.log('--------------------------------------------------');
}

// Parse JSON bodies
app.use(express.json());

// API handler adapter bridging Express to Netlify Web Request/Response handler
app.all('/api/*', async (req, res) => {
  try {
    const fullUrl = `http://${req.headers.host || 'localhost:3000'}${req.originalUrl}`;
    
    // Construct Web Standard Request
    const headers = new Headers();
    for (const [key, val] of Object.entries(req.headers)) {
      if (val !== undefined) {
        if (Array.isArray(val)) {
          val.forEach(v => headers.append(key, v));
        } else {
          headers.set(key, val);
        }
      }
    }

    const hasBody = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase());
    const bodyPayload = hasBody && req.body ? JSON.stringify(req.body) : undefined;

    const webRequest = new Request(fullUrl, {
      method: req.method,
      headers,
      body: bodyPayload
    });

    // Invoke Netlify API Function
    const webResponse = await apiHandler(webRequest, {});

    // Pipe response back to Express
    res.status(webResponse.status);
    webResponse.headers.forEach((val, key) => {
      res.setHeader(key, val);
    });

    const responseText = await webResponse.text();
    res.send(responseText);
  } catch (err: any) {
    console.error('[server] API forwarding error:', err);
    res.status(500).json({ success: false, error: err.message || 'Internal Server Error' });
  }
});

// Serve static frontend from /public
const publicDir = path.resolve(__dirname, 'public');
app.use(express.static(publicDir));

async function startServer() {
  // Mount Vite middlewares for HMR / Vite assets if needed
  try {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'custom'
    });
    app.use(vite.middlewares);
  } catch (err) {
    console.warn('[server] Vite middleware initialization notice:', err);
  }

  // Fallback to /public/index.html for any remaining route
  app.get('*', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`⚡ DealsBot server running at http://0.0.0.0:${PORT}`);
    console.log(`📱 Admin Dashboard available at http://localhost:${PORT}`);
  });
}

startServer();
