// api/rpc.js — Vercel Serverless Proxy → GenLayer studionet
//
// NETWORK ERROR FIX:
// studio.genlayer.com:8443 is Cloudflare-fronted. From Vercel's datacenter
// IPs, port 8443 sometimes hangs at TCP level — the connection never arrives.
// After 58s our timeout fires → but Vercel's 60s maxDuration kills the function
// before the response headers are sent → browser gets a TCP reset →
// Firefox: "NetworkError when attempting to fetch resource."
//
// Fix:
//  1. Try port 443 first (standard HTTPS, almost never firewalled).
//  2. Fall back to port 8443 if 443 fails.
//  3. Reduced timeout to 25s per attempt so we ALWAYS return a JSON response
//     well within Vercel's 60s maxDuration limit.
//  4. Always return valid JSON-RPC — never raw text, never HTML.

const https = require('https');

const STUDIONET_HOSTS = [
  { hostname: 'studio.genlayer.com', port: 443  },  // standard HTTPS — try first
  { hostname: 'studio.genlayer.com', port: 8443 },  // documented port — fallback
];
const UPSTREAM_PATH = '/api';
const TIMEOUT_PER_ATTEMPT = 25000; // 25s — 2 attempts = 50s max < 60s maxDuration

function tryConnect(host, bodyBuffer) {
  return new Promise(function(resolve, reject) {
    var req = https.request({
      hostname: host.hostname,
      port:     host.port,
      path:     UPSTREAM_PATH,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': bodyBuffer.length,
        'User-Agent':     'Mozilla/5.0 (compatible; EngageChain/1.0)',
        'Accept':         'application/json',
      },
    }, function(upstream) {
      var chunks = [];
      upstream.on('data', function(c) { chunks.push(c); });
      upstream.on('end',  function() {
        resolve({
          status: upstream.statusCode,
          body:   Buffer.concat(chunks).toString('utf8'),
        });
      });
      upstream.on('error', reject);
    });

    req.on('error', reject);
    req.setTimeout(TIMEOUT_PER_ATTEMPT, function() {
      req.destroy(new Error('TCP timeout after ' + (TIMEOUT_PER_ATTEMPT/1000) + 's on port ' + host.port));
    });

    req.write(bodyBuffer);
    req.end();
  });
}

async function forwardToStudionet(bodyString) {
  var buf = Buffer.from(bodyString, 'utf8');
  var lastErr;

  for (var i = 0; i < STUDIONET_HOSTS.length; i++) {
    var host = STUDIONET_HOSTS[i];
    try {
      var result = await tryConnect(host, buf);
      console.log('[rpc] connected via port', host.port, '| HTTP', result.status);
      return result;
    } catch (err) {
      console.log('[rpc] port', host.port, 'failed:', err.message);
      lastErr = err;
    }
  }
  throw lastErr;
}

function extractId(bodyString) {
  try { return JSON.parse(bodyString).id || null; } catch (_) { return null; }
}

function jsonRpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id, error: { code: code, message: message } };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age',        '86400');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json(jsonRpcError(null, -32000, 'Method not allowed'));
  }

  var bodyString;
  try {
    bodyString = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  } catch (e) {
    return res.status(200).json(jsonRpcError(null, -32700, 'Invalid request body'));
  }

  var reqId = extractId(bodyString);
  try {
    var p = JSON.parse(bodyString);
    console.log('[rpc] method:', p.method || '?', '| id:', reqId);
  } catch (_) {}

  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  try {
    var result  = await forwardToStudionet(bodyString);
    var rawText = result.body;
    var status  = result.status;

    // Validate the upstream response is JSON before forwarding
    // (Cloudflare error pages like "error code: 522" are plain text)
    var parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (_) {
      var preview = rawText ? rawText.trim().slice(0, 150) : 'empty';
      console.error('[rpc] non-JSON upstream (HTTP', status + '):', preview);
      return res.status(200).json(jsonRpcError(
        reqId, -32603,
        'Studionet returned non-JSON (HTTP ' + status + '). ' +
        'The network may be temporarily unavailable. Try again in a moment.'
      ));
    }

    return res.status(200).json(parsed);

  } catch (err) {
    console.error('[rpc] connection error:', err.message);
    return res.status(200).json(jsonRpcError(
      reqId, -32603,
      'Cannot reach studionet: ' + err.message +
      '. The GenLayer Studio network may be temporarily down.'
    ));
  }
};
