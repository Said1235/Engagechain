/**
 * EngageChain — app.js  (Final Production Version)
 *
 * Contract  : 0x102625d1C7329faD69057744B38e2C924afd3dB4
 * Network   : GenLayer studionet
 *
 * ══ ROOT CAUSE FIX ════════════════════════════════════════════════════════
 *
 * Previous versions fell back to studio.genlayer.com:8443 when the proxy
 * was unreachable. This ALWAYS fails for writes because:
 *   - Browsers enforce CORS. studio.genlayer.com:8443 does NOT send
 *     CORS headers → every write from the browser gets "NetworkError".
 *   - There is NO workaround. The proxy is MANDATORY for writes.
 *
 * Fix: two separate endpoint variables:
 *   proxyEndpoint  — used for ALL writes (mandatory, must go through proxy)
 *   readEndpoint   — used for reads (proxy if available, studionet if not)
 *
 * If the proxy is unreachable and the user tries to write, we show a
 * clear actionable error instead of a cryptic "NetworkError".
 *
 * ══ METAMASK ══════════════════════════════════════════════════════════════
 *
 * MetaMask cannot sign GenLayer's custom tx format. Passing just an address
 * string to createClient() creates a view-only viem account — writes fail.
 * Fix: always use createAccount() for actual signing. MetaMask address is
 * shown in the UI only. This is standard for GenLayer studionet.
 *
 * ══ ENVIRONMENTS ═════════════════════════════════════════════════════════
 *
 * Vercel production:  proxy /api/rpc exists → full functionality ✓
 * vercel dev (local): proxy /api/rpc exists → full functionality ✓
 * Plain local:        proxy not found → reads via studionet direct ✓
 *                                       writes blocked (clear error shown)
 */

const CONTRACT_ADDRESS  = '0x102625d1C7329faD69057744B38e2C924afd3dB4';
const STUDIONET_DIRECT  = 'https://studio.genlayer.com:8443/api';
const ZERO_ADDR         = '0x0000000000000000000000000000000000000000';

// Set at boot by detectEndpoint()
let proxyEndpoint  = null;   // proxy URL — null if not available
let readEndpoint   = STUDIONET_DIRECT;  // always has a valid value

let _gl      = null;
let _chains  = null;
let client   = null;
let account  = null;
let walletMode       = null;
let currentOpinionId = null;
let termOpen         = true;

// ════════════════════════════════════════════════════════
//  Boot
// ════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  termLog('info', 'EngageChain — ' + CONTRACT_ADDRESS);
  detectEndpoint();
  refreshTotalSubmissions();

  document.getElementById('wallet-modal').addEventListener('click', function(e) {
    if (e.target.id === 'wallet-modal') closeModal();
  });

  attachMetaMaskListeners();

  document.getElementById('term-toggle').addEventListener('click', function(e) {
    e.stopPropagation();
    toggleTerminal();
  });
});

// ════════════════════════════════════════════════════════
//  Endpoint detection — simple and reliable
//
//  Only ONE case has no proxy: file:// (HTML opened directly).
//  Every other case — localhost via server.js OR Vercel — has a
//  working /api/rpc endpoint at the same origin.
//
//  Local:  node server.js → http://localhost:3001/api/rpc  ✓
//  Vercel: deploy         → https://app.vercel.app/api/rpc ✓
//  file:// reads only     → studionet direct               ✓
// ════════════════════════════════════════════════════════
function detectEndpoint() {
  var proto  = window.location.protocol;
  var origin = window.location.origin;

  // file:// has no server — proxy doesn't exist
  var noProxy = (proto === 'file:' || origin === 'null' || origin === '');

  if (noProxy) {
    proxyEndpoint = null;
    readEndpoint  = STUDIONET_DIRECT;
    termLog('info', 'File mode — reads via studionet ✓  (run: node server.js for full access)');
  } else {
    // HTTP or HTTPS server is running (localhost:3001 or Vercel)
    // /api/rpc exists in both cases
    proxyEndpoint = origin + '/api/rpc';
    readEndpoint  = proxyEndpoint;
    termLog('success', 'Ready — proxy: ' + proxyEndpoint);
  }
}

// ════════════════════════════════════════════════════════
//  MetaMask listeners
// ════════════════════════════════════════════════════════
function attachMetaMaskListeners() {
  function setup(provider) {
    if (!provider || provider._ecInit) return;
    provider._ecInit = true;
    provider.on('accountsChanged', function(accs) {
      if (walletMode !== 'metamask') return;
      if (!accs.length) { disconnectWallet(); showToast('MetaMask disconnected', 'error'); }
      else { onConnected(accs[0], 'metamask'); termLog('info', 'MM account: ' + accs[0]); }
    });
    provider.on('chainChanged', function() {
      termLog('warn', 'MetaMask chain changed');
    });
  }
  if (window.ethereum) { setup(window.ethereum); }
  else { window.addEventListener('ethereum#initialized', function() { setup(window.ethereum); }, { once: true }); }
}

// ════════════════════════════════════════════════════════
//  Wait for MetaMask injection — three parallel strategies
//  A. Already present   B. Poll 100ms   C. Event   D. Timeout
// ════════════════════════════════════════════════════════
function waitForEthereum(ms) {
  ms = ms || 3000;
  if (window.ethereum) return Promise.resolve(window.ethereum);
  return new Promise(function(resolve) {
    var done = false;
    function finish(val) {
      if (done) return; done = true;
      clearInterval(poll); clearTimeout(timer);
      window.removeEventListener('ethereum#initialized', onEv);
      resolve(val || null);
    }
    var poll  = setInterval(function() { if (window.ethereum) finish(window.ethereum); }, 100);
    function onEv() { finish(window.ethereum); }
    window.addEventListener('ethereum#initialized', onEv, { once: true });
    var timer = setTimeout(function() { finish(window.ethereum); }, ms);
  });
}

// ════════════════════════════════════════════════════════
//  Modal
// ════════════════════════════════════════════════════════
function openModal()  { document.getElementById('wallet-modal').classList.remove('hidden'); }
function closeModal() { document.getElementById('wallet-modal').classList.add('hidden'); }

// ════════════════════════════════════════════════════════
//  Load genlayer-js SDK (lazy — only on first Connect click)
// ════════════════════════════════════════════════════════
async function _loadGL() {
  if (_gl && _chains) return;
  termLog('info', 'Loading genlayer-js SDK…');
  try {
    var results = await Promise.all([
      import('https://esm.sh/genlayer-js@latest'),
      import('https://esm.sh/genlayer-js@latest/chains'),
    ]);
    _gl     = results[0];
    _chains = results[1];
    termLog('success', 'SDK loaded ✓');
  } catch (err) {
    throw new Error('SDK load failed: ' + err.message + '. Check internet connection.');
  }
}

// ════════════════════════════════════════════════════════
//  Build genlayer-js client
//
//  CRITICAL: endpoint MUST be the proxy URL.
//  studio.genlayer.com:8443 blocks CORS from browsers.
//  If proxyEndpoint is null (local without vercel dev),
//  we still build the client — but writes will fail at
//  contractWrite() with a clear user-facing message.
//
//  account MUST be a createAccount() object — never a bare
//  address string. Bare addresses create view-only viem accounts
//  that cannot sign GenLayer's custom transaction format.
// ════════════════════════════════════════════════════════
function _buildClient() {
  // Use proxy if available; fall back to studionet direct
  // (writes will fail with CORS if using studionet direct, but
  //  contractWrite() catches this and shows a clear error)
  var ep = proxyEndpoint || STUDIONET_DIRECT;
  termLog('info', 'Client endpoint: ' + ep);
  client = _gl.createClient({
    chain:    _chains.studionet,
    account:  account,    // always createAccount() — real signing key
    endpoint: ep,
  });
}

// ════════════════════════════════════════════════════════
//  Auto Connect — generates a studionet testnet account
// ════════════════════════════════════════════════════════
async function connectAuto() {
  _setModalLoading(true, 'auto');
  try {
    await _loadGL();
    account = _gl.createAccount();
    _buildClient();
    walletMode = 'auto';
    closeModal();
    onConnected(account.address, 'auto');
    termLog('success', 'Auto wallet: ' + account.address);
    showToast('Testnet wallet connected ✓', 'success');
  } catch (err) {
    console.error('[connectAuto]', err);
    termLog('error', err.message);
    showToast('Error: ' + err.message, 'error');
  } finally {
    _setModalLoading(false, 'auto');
  }
}

// ════════════════════════════════════════════════════════
//  MetaMask Connect
//
//  Opens MetaMask popup to identify the user's address.
//  ALWAYS uses createAccount() for actual GenLayer signing —
//  MetaMask cannot sign GenLayer's custom tx format.
//  The MetaMask address is displayed in the UI only.
// ════════════════════════════════════════════════════════
async function connectMetaMask() {
  _setModalLoading(true, 'metamask');
  try {
    await _loadGL();

    var provider = await waitForEthereum(4000);
    if (!provider) {
      termLog('error', 'MetaMask not detected. Install the extension and refresh.');
      showToast('MetaMask not detected — install it and refresh.', 'error');
      return;
    }

    termLog('info', 'MetaMask detected. Requesting accounts…');
    var accounts;
    try {
      accounts = await provider.request({ method: 'eth_requestAccounts' });
    } catch (err) {
      if (err.code === 4001)   throw new Error('Rejected by user.');
      if (err.code === -32002) throw new Error('Pending — open MetaMask.');
      throw err;
    }
    if (!accounts || !accounts.length) throw new Error('No accounts returned from MetaMask.');

    var mmAddress = accounts[0];

    // Always create a real signing account for GenLayer transactions
    account = _gl.createAccount();
    _buildClient();
    walletMode = 'metamask';

    attachMetaMaskListeners();
    closeModal();
    onConnected(mmAddress, 'metamask');
    termLog('success', 'MetaMask address: ' + mmAddress);
    termLog('info',    'Signing via: ' + account.address);
    showToast('MetaMask connected: ' + mmAddress.slice(0,8) + '…', 'success');

  } catch (err) {
    console.error('[connectMetaMask]', err);
    termLog('error', err.message);
    showToast(err.message, 'error');
  } finally {
    _setModalLoading(false, 'metamask');
  }
}

// ════════════════════════════════════════════════════════
//  Disconnect
// ════════════════════════════════════════════════════════
function disconnectWallet() {
  client = null; account = null; walletMode = null; currentOpinionId = null;
  document.getElementById('connect-label').textContent = 'Connect Wallet';
  document.getElementById('connect-dot').style.background = '';
  document.getElementById('not-connected-msg').classList.remove('hidden');
  document.getElementById('connected-form').classList.add('hidden');
  document.getElementById('btn-disconnect').classList.add('hidden');
  hideEl('submit-result'); hideEl('ai-result'); hideEl('finalized-banner');
  termLog('info', 'Wallet disconnected.');
  showToast('Wallet disconnected', 'success');
}

function onConnected(address, mode) {
  var short = address.slice(0, 6) + '…' + address.slice(-4);
  var label = (mode === 'metamask' ? '🦊 ' : '⚡ ') + short;
  document.getElementById('connect-label').textContent    = label;
  document.getElementById('connect-dot').style.background = 'var(--accent)';
  document.getElementById('connected-addr').textContent   = label;
  document.getElementById('not-connected-msg').classList.add('hidden');
  document.getElementById('connected-form').classList.remove('hidden');
  document.getElementById('btn-disconnect').classList.remove('hidden');
}

function _setModalLoading(on, which) {
  ['modal-auto-btn', 'modal-mm-btn'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.style.pointerEvents = on ? 'none' : '';
  });
  var id    = which === 'auto' ? 'modal-auto-btn' : 'modal-mm-btn';
  var title = document.getElementById(id) && document.getElementById(id).querySelector('.wallet-option-title');
  if (title) title.textContent = on ? 'Connecting…' : (which === 'auto' ? 'Auto Connect' : 'MetaMask');
}

// ════════════════════════════════════════════════════════
//  Terminal
// ════════════════════════════════════════════════════════
function toggleTerminal() {
  termOpen = !termOpen;
  document.getElementById('term-body').style.display  = termOpen ? '' : 'none';
  document.getElementById('term-chevron').textContent = termOpen ? '▼' : '▶';
}

function termLog(type, msg) {
  var log = document.getElementById('term-body');
  if (!log) return;
  var icons  = { info:'›', success:'✓', error:'✗', tx:'⬡', ai:'◉', warn:'⚠' };
  var colors = { info:'#8896a5', success:'#00e5c3', error:'#f43f5e', tx:'#a78bfa', ai:'#f59e0b', warn:'#f59e0b' };
  var line   = document.createElement('div');
  line.className = 'term-line term-line--' + type;
  var ts = new Date().toLocaleTimeString('en-US', { hour12: false });
  line.innerHTML =
    '<span class="term-ts">'   + ts + '</span>' +
    '<span class="term-icon" style="color:' + (colors[type] || colors.info) + '">' + (icons[type] || '›') + '</span>' +
    '<span class="term-msg">'  + escapeHtml(String(msg)) + '</span>';
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
  while (log.children.length > 300) log.removeChild(log.firstChild);
}

// ════════════════════════════════════════════════════════
//  READ — uses client.readContract() when SDK is loaded,
//  falls back to raw gen_call for boot-time reads.
//
//  client.readContract() is the official genlayer-js SDK
//  method — it handles GenLayer type serialization correctly
//  and avoids "Value must be an instance of str" errors.
//
//  Raw gen_call is used only when client isn't built yet
//  (e.g. page-load stat fetch before user connects wallet).
// ════════════════════════════════════════════════════════
async function rpcRead(fn, args) {
  args = args || [];
  termLog('info', fn + '(' + args.join(', ') + ')');

  // Prefer SDK readContract — handles type serialization correctly
  if (client) {
    try {
      var result = await client.readContract({
        address:      CONTRACT_ADDRESS,
        functionName: fn,
        args:         args,
      });
      termLog('success', fn + ' ✓');
      return result;
    } catch (err) {
      termLog('error', fn + ' failed: ' + err.message);
      throw err;
    }
  }

  // Fallback: raw gen_call for boot-time reads (before wallet connect)
  var body = JSON.stringify({
    jsonrpc: '2.0',
    id:      Date.now(),
    method:  'gen_call',
    params: [{
      from:   ZERO_ADDR,
      to:     CONTRACT_ADDRESS,
      type:   'read',
      data:   { function: fn, args: args },
      status: 'accepted',
    }],
  });

  try {
    var res  = await fetch(readEndpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    body,
    });
    var json = await res.json();
    if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
    termLog('success', fn + ' ✓');
    return json.result;
  } catch (err) {
    termLog('error', fn + ' failed: ' + err.message);
    throw err;
  }
}

// ════════════════════════════════════════════════════════
//  WRITE — client.writeContract()
//
//  CRITICAL: proxy is MANDATORY for writes.
//  studio.genlayer.com:8443 blocks CORS from browsers.
//  If proxyEndpoint is null, we fail early with a clear message.
//
//  Per GenLayer docs:
//  - writeContract returns txHash
//  - waitForTransactionReceipt polls until FINALIZED
//  - always check txExecutionResultName
// ════════════════════════════════════════════════════════
async function contractWrite(functionName, args) {
  args = args || [];
  if (!client) throw new Error('Connect your wallet first.');

  // GUARD: proxy is required for all writes (CORS blocks direct browser→studionet)
  if (!proxyEndpoint) {
    var msg = 'Open via a server to write: run "node server.js" then go to http://localhost:3001';
    termLog('error', msg);
    throw new Error(msg);
  }

  termLog('tx', 'writeContract → ' + functionName +
    '(' + args.map(function(a){ return String(a).slice(0, 60); }).join(', ') + ')');

  var txHash;
  try {
    txHash = await client.writeContract({
      address:      CONTRACT_ADDRESS,
      functionName: functionName,
      args:         args,
      value:        BigInt(0),
    });
  } catch (err) {
    var msg = err.message || String(err);
    // Decode viem's cryptic JSON parse errors into actionable messages
    if (msg.includes('is not valid JSON') || msg.includes('Unexpected token')) {
      throw new Error(
        'Studionet returned an unexpected response (may be temporarily unavailable). ' +
        'Check https://studio.genlayer.com is accessible and try again.'
      );
    }
    if (msg.includes('NetworkError') || msg.includes('Failed to fetch')) {
      throw new Error(
        'Cannot reach studionet through the proxy. ' +
        'Check the Vercel Function Logs for details.'
      );
    }
    throw err;
  }

  termLog('tx', 'txHash: ' + txHash);
  termLog('info', 'Waiting for FINALIZED consensus… (AI calls take 60–120s)');

  var receipt = await client.waitForTransactionReceipt({
    hash:            txHash,
    status:          'FINALIZED',
    interval:        5000,
    retries:         120,
    fullTransaction: true,  // ensure all fields incl. return value are present
  });

  // GenLayer docs: always check txExecutionResultName
  var execResult = receipt && receipt.txExecutionResultName;
  if (execResult && execResult !== 'FINISHED_WITH_RETURN') {
    throw new Error('Execution failed: ' + execResult);
  }

  // Extract return value — field name varies across genlayer-js versions
  var result = null;
  if (receipt) {
    result = receipt.result
          || receipt.return_value
          || receipt.returnValue
          || receipt.data
          || null;
  }
  termLog('success', 'Finalized ✓ result: ' + JSON.stringify(result));
  termLog('info', 'Full receipt keys: ' + (receipt ? Object.keys(receipt).join(', ') : 'null'));
  return { txHash: txHash, receipt: receipt, result: result };
}

// ════════════════════════════════════════════════════════
//  submit_opinion(text: str) → opinion_id: str
// ════════════════════════════════════════════════════════
async function submitOpinion() {
  var text = document.getElementById('opinion-text').value.trim();
  if (!text)              return showToast('Write something first.', 'error');
  if (text.length > 2000) return showToast('Max 2000 characters.', 'error');
  if (!client)            { openModal(); return; }

  setLoading('submit', true);
  hideEl('submit-result'); hideEl('ai-result'); hideEl('finalized-banner');
  termLog('info', 'submit_opinion — ' + text.length + ' chars');

  try {
    var out    = await contractWrite('submit_opinion', [text]);
    var txHash = out.txHash;

    // Extract opinion ID from receipt — try multiple field names
    var opinionId = null;
    var r = out.result || out.receipt;
    if (r) {
      var raw = r.result || r.return_value || r.returnValue || r.data;
      if (raw !== null && raw !== undefined) opinionId = String(raw);
    }

    // Fallback: if receipt didn't include return value, read next_id - 1 from chain
    if (!opinionId || opinionId === 'null' || opinionId === 'undefined') {
      termLog('info', 'Return value not in receipt — reading ID from chain…');
      try {
        // Wait briefly for state to settle, then query total (= last_id + 1)
        await new Promise(function(r){ setTimeout(r, 2000); });
        var total = await rpcRead('get_total_submissions', []);
        var totalNum = parseInt(String(total), 10);
        if (!isNaN(totalNum) && totalNum > 0) {
          opinionId = String(totalNum - 1);
          termLog('success', 'Got opinion ID from chain: ' + opinionId);
        }
      } catch (e) {
        termLog('warn', 'Could not read ID from chain: ' + e.message);
      }
    }

    // Last resort: set to 0 (user submitted at least one opinion)
    if (!opinionId || opinionId === 'null' || opinionId === 'undefined') {
      opinionId = '0';
      termLog('warn', 'Using fallback ID 0 — check Studio for actual ID');
    }

    currentOpinionId = opinionId;
    document.getElementById('result-id').textContent = opinionId;
    document.getElementById('result-tx').textContent = txHash;
    setStatusBadge('result-status', 'pending');
    showEl('submit-result');
    refreshTotalSubmissions();
    termLog('success', 'Opinion on-chain — ID: ' + opinionId);
    showToast('Submitted! Opinion ID: ' + opinionId, 'success');
  } catch (err) {
    termLog('error', err.message);
    showToast('Error: ' + err.message, 'error');
    console.error('[submit_opinion]', err);
  } finally {
    setLoading('submit', false);
  }
}

// ════════════════════════════════════════════════════════
//  evaluate_opinion(opinion_id: str)
// ════════════════════════════════════════════════════════
async function evaluateOpinion() {
  if (!currentOpinionId) return showToast('Submit an opinion first.', 'error');
  setLoading('eval', true);
  termLog('ai', 'evaluate_opinion(' + currentOpinionId + ') → AI validators…');
  showToast('AI validators evaluating… (60–120s)', 'success');

  try {
    await contractWrite('evaluate_opinion', [currentOpinionId]);
    var entry = await rpcRead('get_resolution_data', [currentOpinionId]);
    renderAiResponse(entry && entry.ai_response ? entry.ai_response : '');
    setStatusBadge('result-status', 'evaluated');
    showEl('ai-result');
    termLog('success', 'AI evaluation complete ◉');
    showToast('AI evaluation complete ◉', 'success');
  } catch (err) {
    termLog('error', err.message);
    showToast('Error: ' + err.message, 'error');
    console.error('[evaluate_opinion]', err);
  } finally {
    setLoading('eval', false);
  }
}

// ════════════════════════════════════════════════════════
//  finalize_opinion(opinion_id: str, verdict: str)
// ════════════════════════════════════════════════════════
async function finalizeOpinion() {
  if (!currentOpinionId) return showToast('No opinion to finalize.', 'error');
  var rec     = document.getElementById('ai-recommendation').textContent;
  var verdict = (rec && rec !== '—') ? rec : 'Verified by GenLayer consensus';
  termLog('tx', 'finalize_opinion(' + currentOpinionId + ')');
  setLoading('final', true);

  try {
    await contractWrite('finalize_opinion', [currentOpinionId, verdict]);
    setStatusBadge('result-status', 'finalized');
    showEl('finalized-banner');
    termLog('success', 'Opinion finalized on-chain ⛓');
    showToast('Finalized on-chain ⛓', 'success');
  } catch (err) {
    termLog('error', err.message);
    showToast('Error: ' + err.message, 'error');
    console.error('[finalize_opinion]', err);
  } finally {
    setLoading('final', false);
  }
}

// ════════════════════════════════════════════════════════
//  lookupOpinion — prints result into the terminal
// ════════════════════════════════════════════════════════
async function lookupOpinion() {
  var rawId = document.getElementById('lookup-id').value.trim();
  if (!rawId) return showToast('Enter an opinion ID.', 'error');

  setLoading('lookup', true);
  termLog('info', '─────────────────────────────────────');
  termLog('info', 'Lookup opinion ID: ' + rawId);

  try {
    var data = await rpcRead('get_resolution_data', [rawId]);
    termLog('success', '┌── Opinion #' + (data.id || rawId) + ' ──────────────────');
    termLog('info',    '│ Status : ' + (data.status || '—'));
    termLog('info',    '│ Author : ' + (data.author || '—'));
    termLog('info',    '│ Text   : ' + String(data.text || '—').slice(0, 120));

    var ai = data.ai_response || '';
    if (ai) {
      try {
        var p = JSON.parse(ai);
        termLog('ai', '│ Summary       : ' + (p.summary || '—'));
        termLog('ai', '│ Sentiment     : ' + (p.sentiment || '—'));
        termLog('ai', '│ Category      : ' + (p.category || '—'));
        termLog('ai', '│ Confidence    : ' + Math.round(parseFloat(p.confidence_score || 0) * 100) + '%');
        termLog('ai', '│ Recommendation: ' + (p.ai_recommendation || '—'));
      } catch (_) { termLog('ai', '│ AI: ' + ai.slice(0, 120)); }
    } else {
      termLog('info', '│ AI Response: (not evaluated yet)');
    }

    if (data.verdict) termLog('success', '│ Verdict: ' + data.verdict);
    termLog('success', '└─────────────────────────────────────');
    showToast('Opinion #' + rawId + ' — see terminal', 'success');
  } catch (err) {
    termLog('error', 'Lookup #' + rawId + ' failed: ' + err.message);
    showToast('Error: ' + err.message, 'error');
  } finally {
    setLoading('lookup', false);
  }
}

// ════════════════════════════════════════════════════════
//  get_total_submissions()
// ════════════════════════════════════════════════════════
async function refreshTotalSubmissions() {
  // get_total_submissions can fail right after a write (GenLayer timing).
  // Retry up to 3 times with 3s delay. Failure is non-critical — UI keeps working.
  var attempts = 3;
  for (var i = 0; i < attempts; i++) {
    try {
      if (i > 0) await new Promise(function(r){ setTimeout(r, 3000); });
      var total = await rpcRead('get_total_submissions', []);
      var totalStr = String(total);
      // Validate it's a numeric string before showing it
      if (/^\d+$/.test(totalStr)) {
        document.getElementById('stat-total').textContent = totalStr;
        termLog('info', 'Total on-chain: ' + totalStr);
        return;
      }
    } catch (_) {
      if (i < attempts - 1) {
        termLog('info', 'Retrying total count (' + (i+2) + '/' + attempts + ')…');
      }
      // silently ignore final failure — non-critical stat
    }
  }
}

// ════════════════════════════════════════════════════════
//  Render AI JSON into UI fields
// ════════════════════════════════════════════════════════
function renderAiResponse(raw) {
  var data;
  try {
    var clean = (typeof raw === 'string' ? raw : JSON.stringify(raw))
      .replace(/```json|```/g, '').trim();
    data = JSON.parse(clean);
  } catch (_) {
    data = { summary: raw, sentiment:'—', category:'—', key_points:[], ai_recommendation: raw, confidence_score: '0' };
  }
  document.getElementById('ai-summary').textContent        = data.summary          || '—';
  document.getElementById('ai-sentiment').textContent      = data.sentiment         || '—';
  document.getElementById('ai-category').textContent       = data.category          || '—';
  document.getElementById('ai-recommendation').textContent = data.ai_recommendation || '—';
  document.getElementById('ai-points').innerHTML =
    (data.key_points || []).map(function(p){ return '<li>' + escapeHtml(String(p)) + '</li>'; }).join('');
  var pct = Math.round(parseFloat(data.confidence_score || 0) * 100);
  document.getElementById('confidence-bar').style.width = pct + '%';
  document.getElementById('confidence-val').textContent  = pct + '%';
  termLog('ai', 'AI: ' + (data.sentiment || '—') + ' | confidence ' + pct + '%');
}

// ════════════════════════════════════════════════════════
//  UI helpers
// ════════════════════════════════════════════════════════
function updateCharCount() {
  var n = document.getElementById('opinion-text').value.length;
  document.getElementById('char-count').textContent = n + ' / 2000';
}

function setLoading(a, on) {
  var s = document.getElementById(a + '-spinner');
  var l = document.getElementById(a + '-label');
  var b = s && s.closest('button');
  if (s) s.classList.toggle('hidden', !on);
  if (b) b.disabled = on;
  var labels = {
    submit: ['Submit to GenLayer',  'Submitting…'],
    eval:   ['▶ Evaluate with AI',  'Evaluating… (1–2 min)'],
    final:  ['⬡ Finalize on-chain', 'Finalizing…'],
    lookup: ['Read from Chain',     'Reading…'],
  };
  if (l && labels[a]) l.textContent = on ? labels[a][1] : labels[a][0];
}

function setStatusBadge(id, s) {
  var el = document.getElementById(id);
  if (el) { el.textContent = s; el.className = 'status-badge status-' + s; }
}
function showEl(id) { var e = document.getElementById(id); if (e) e.classList.remove('hidden'); }
function hideEl(id) { var e = document.getElementById(id); if (e) e.classList.add('hidden'); }
function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

var _toastT;
function showToast(msg, type) {
  type = type || '';
  var old = document.querySelector('.toast');
  if (old) old.remove();
  clearTimeout(_toastT);
  var t = document.createElement('div');
  t.className   = 'toast' + (type ? ' toast-' + type : '');
  t.textContent = msg;
  document.body.appendChild(t);
  _toastT = setTimeout(function(){ t.remove(); }, 6000);
}
