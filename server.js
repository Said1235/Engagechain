/**
 * EngageChain — Local Development Server
 * ═══════════════════════════════════════
 * Run:  node server.js
 * Open: http://localhost:3001
 *
 * Does two things:
 *  1. Serves static files (index.html, app.js, styles.css)
 *  2. Proxies POST /api/rpc → studio.genlayer.com:8443/api
 *
 * Zero dependencies — pure Node.js built-ins only.
 * Works with any Node.js version ≥ 14.
 */

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const PORT = process.env.PORT || 3001;

// Try port 443 first (standard HTTPS), fall back to 8443
const STUDIONET_HOSTS = [
  { hostname: 'studio.genlayer.com', port: 443  },
  { hostname: 'studio.genlayer.com', port: 8443 },
];
const STUDIONET_PATH = '/api';
const TIMEOUT_PER_ATTEMPT = 25000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
};

// ── Forward body to GenLayer studionet ─────────────────────────────────────
function tryHost(host, buf) {
  return new Promise(function(resolve, reject) {
    var req = https.request({
      hostname: host.hostname,
      port:     host.port,
      path:     STUDIONET_PATH,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': buf.length,
      },
    }, function(res) {
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end',  function()  { resolve(Buffer.concat(chunks).toString('utf8')); });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(TIMEOUT_PER_ATTEMPT, function() {
      req.destroy(new Error('Timeout on port ' + host.port));
    });
    req.write(buf);
    req.end();
  });
}

async function proxyToStudionet(body) {
  var buf = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
  var lastErr;
  for (var i = 0; i < STUDIONET_HOSTS.length; i++) {
    try {
      var result = await tryHost(STUDIONET_HOSTS[i], buf);
      return result;
    } catch (err) {
      console.log('[proxy] port', STUDIONET_HOSTS[i].port, 'failed:', err.message);
      lastErr = err;
    }
  }
  throw lastErr;
}

// ── HTTP server ─────────────────────────────────────────────────────────────
var server = http.createServer(function(req, res) {
  // CORS — needed so the browser can call /api/rpc from the same origin
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // ── Proxy: POST /api/rpc ──────────────────────────────────────────────────
  if (req.url === '/api/rpc' && req.method === 'POST') {
    var chunks = [];
    req.on('data', function(c) { chunks.push(c); });
    req.on('end', function() {
      var body = Buffer.concat(chunks).toString('utf8');

      // Log to console for debugging
      try {
        var parsed = JSON.parse(body);
        console.log('[proxy]', parsed.method || '?');
      } catch (_) {}

      proxyToStudionet(body)
        .then(function(text) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(text);
        })
        .catch(function(err) {
          console.error('[proxy] error:', err.message);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0', id: null,
            error: { code: -32603, message: 'Local proxy error: ' + err.message },
          }));
        });
    });
    return;
  }

  // ── Static files ─────────────────────────────────────────────────────────
  var filePath = req.url.split('?')[0]; // strip query string
  if (filePath === '/' || filePath === '') filePath = '/index.html';

  // Security: prevent path traversal
  var safePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
  var fullPath = path.join(__dirname, safePath);

  fs.readFile(fullPath, function(err, data) {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found: ' + safePath);
      return;
    }
    var ext  = path.extname(fullPath).toLowerCase();
    var mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

server.listen(PORT, function() {
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║         EngageChain — Local Server           ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log('║  Open:  http://localhost:' + PORT + '              ║');
  console.log('║  Proxy: /api/rpc → studio.genlayer.com:8443  ║');
  console.log('║  Stop:  Ctrl+C                               ║');
  console.log('╚══════════════════════════════════════════════╝\n');
});
