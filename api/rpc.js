// api/rpc.js — Vercel serverless proxy
// Forwards ALL JSON-RPC requests to GenLayer studionet.
// Required because browsers cannot reach studio.genlayer.com:8443 directly (CORS).

const GENLAYER_RPC = 'https://studio.genlayer.com:8443/api';

module.exports = async function handler(req, res) {
  // ── CORS — allow all origins ──────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Vercel auto-parses JSON body — re-stringify for the outbound fetch
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

    // Log the method being proxied for debugging
    const parsed = typeof req.body === 'object' ? req.body : {};
    console.log('[rpc proxy] method:', parsed.method, 'id:', parsed.id);

    const upstream = await fetch(GENLAYER_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    const text = await upstream.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res.status(200).send(text);
    }

    return res.status(200).json(data);

  } catch (err) {
    console.error('[rpc proxy] error:', err.message);
    return res.status(500).json({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32603, message: 'Proxy error: ' + err.message },
    });
  }
};
