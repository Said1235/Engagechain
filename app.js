/**
 * EngageChain v2 — app.js
 *
 * Contract : 0x7D361211C5C2cB0A6066D583527F45EaE544e468
 * Network  : GenLayer studionet
 *
 * New in v2:
 *  - Rich text editor (contenteditable + toolbar)
 *  - Expandable / resizable terminal (drag handle)
 *  - Terminal separated from form with its own column
 *  - After submit: choice between GenLayer AI or External AI
 *  - External AI: user pastes own analysis → stored on-chain via submit_with_external_ai
 *  - Opinion ID shown both in terminal AND in the UI step card
 *  - Loading animations in terminal (spinner dots)
 */

const CONTRACT_ADDRESS = '0x7D361211C5C2cB0A6066D583527F45EaE544e468';
const ZERO_ADDR        = '0x0000000000000000000000000000000000000000';
const STUDIONET_DIRECT = 'https://studio.genlayer.com:8443/api';

let proxyEndpoint  = null;
let readEndpoint   = STUDIONET_DIRECT;

let _gl        = null;
let _chains    = null;
let client     = null;
let account    = null;
let walletMode = null;
let currentOpinionId = null;
let termOpen   = true;
let termSpinnerInterval = null;

// ════════════════════════════════════════════════════════
//  Session persistence helpers
// ════════════════════════════════════════════════════════
var SESSION_KEY = 'engagechain_session';

function saveSession(mode, address, privKey) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ mode: mode, address: address, privKey: privKey || null }));
  } catch(_) {}
}

function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch(_) {}
}

async function restoreSession() {
  try {
    var raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return;
    var s = JSON.parse(raw);
    if (!s || !s.mode) return;

    await _loadGL();

    if (s.mode === 'auto' && s.privKey) {
      // Restore auto wallet using saved private key
      account = _gl.createAccount(s.privKey);
      _buildClient();
      walletMode = 'auto';
      onConnected(account.address, 'auto');
      termLog('success', 'Session restored ⚡ ' + account.address.slice(0,10) + '…');
    } else if (s.mode === 'metamask' && s.address) {
      // For MetaMask: restore display; signing uses a new account
      account = _gl.createAccount();
      _buildClient();
      walletMode = 'metamask';
      onConnected(s.address, 'metamask');
      termLog('success', 'Session restored 🦊 ' + s.address.slice(0,10) + '…');
    }
  } catch(_) { clearSession(); }
}

// ════════════════════════════════════════════════════════
//  Boot
// ════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  detectEndpoint();
  refreshTotalSubmissions();

  document.getElementById('wallet-modal').addEventListener('click', function(e) {
    if (e.target.id === 'wallet-modal') closeModal();
  });

  attachMetaMaskListeners();
  initTerminalResize();

  // Restore wallet session from previous visit
  restoreSession().catch(function() {});
});

// ════════════════════════════════════════════════════════
//  Endpoint detection — URL-based, no network probe
// ════════════════════════════════════════════════════════
function detectEndpoint() {
  var proto  = window.location.protocol;
  var origin = window.location.origin;
  var isFile = (proto === 'file:' || origin === 'null' || origin === '');

  if (!isFile) {
    proxyEndpoint = origin + '/api/rpc';
    readEndpoint  = proxyEndpoint;
    termLog('success', 'Ready — proxy: ' + proxyEndpoint);
  } else {
    proxyEndpoint = null;
    readEndpoint  = STUDIONET_DIRECT;
    termLog('info', 'Local file mode — reads via studionet ✓ | run: node server.js for writes');
  }
}

// ════════════════════════════════════════════════════════
//  Terminal — resizable via drag handle
// ════════════════════════════════════════════════════════
function initTerminalResize() {
  var handle  = document.getElementById('term-resize');
  var panel   = document.getElementById('terminal-panel');
  var body    = document.getElementById('term-body');
  if (!handle || !panel) return;

  var dragging = false, startY = 0, startH = 0;

  handle.addEventListener('mousedown', function(e) {
    dragging = true;
    startY   = e.clientY;
    startH   = body.offsetHeight;
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', function(e) {
    if (!dragging) return;
    var newH = Math.max(80, Math.min(600, startH + (e.clientY - startY)));
    body.style.height = newH + 'px';
  });

  document.addEventListener('mouseup', function() {
    dragging = false;
    document.body.style.userSelect = '';
  });

  // Touch support
  handle.addEventListener('touchstart', function(e) {
    dragging = true;
    startY   = e.touches[0].clientY;
    startH   = body.offsetHeight;
    e.preventDefault();
  }, { passive: false });

  document.addEventListener('touchmove', function(e) {
    if (!dragging) return;
    var newH = Math.max(80, Math.min(600, startH + (e.touches[0].clientY - startY)));
    body.style.height = newH + 'px';
  });

  document.addEventListener('touchend', function() { dragging = false; });
}

function toggleTerminal() {
  termOpen = !termOpen;
  var body    = document.getElementById('term-body');
  var chevron = document.getElementById('term-chevron');
  var handle  = document.getElementById('term-resize');
  body.style.display    = termOpen ? '' : 'none';
  if (handle) handle.style.display = termOpen ? '' : 'none';
  chevron.textContent   = termOpen ? '▼' : '▶';
}

// ════════════════════════════════════════════════════════
//  Terminal logging with animated loading state
// ════════════════════════════════════════════════════════
var _spinnerEl = null;

function termLog(type, msg) {
  var log = document.getElementById('term-body');
  if (!log) return;
  var icons  = { info:'›', success:'✓', error:'✗', tx:'⬡', ai:'◉', warn:'⚠' };
  var colors = { info:'#8896a5', success:'#00e5c3', error:'#f43f5e', tx:'#a78bfa', ai:'#f59e0b', warn:'#f59e0b' };
  var line   = document.createElement('div');
  line.className = 'term-line term-line--' + type;
  var ts = new Date().toLocaleTimeString('en-US', { hour12: false });
  line.innerHTML =
    '<span class="term-ts">' + ts + '</span>' +
    '<span class="term-icon" style="color:' + (colors[type] || colors.info) + '">' + (icons[type] || '›') + '</span>' +
    '<span class="term-msg">' + escapeHtml(String(msg)) + '</span>';
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
  while (log.children.length > 300) log.removeChild(log.firstChild);
}

function termStartSpinner(msg) {
  termStopSpinner();
  var log = document.getElementById('term-body');
  if (!log) return;
  var line = document.createElement('div');
  line.className = 'term-line term-line--info term-spinner-line';
  var ts = new Date().toLocaleTimeString('en-US', { hour12: false });
  line.innerHTML =
    '<span class="term-ts">' + ts + '</span>' +
    '<span class="term-icon term-spin" id="spinner-icon" style="color:#a78bfa">⟳</span>' +
    '<span class="term-msg" id="spinner-msg">' + escapeHtml(msg) + '</span>';
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
  _spinnerEl = line;
  // Animate the dots after the message
  var dots = 0;
  termSpinnerInterval = setInterval(function() {
    var el = document.getElementById('spinner-msg');
    if (el) {
      dots = (dots + 1) % 4;
      el.textContent = msg + '.'.repeat(dots);
    }
  }, 400);
}

function termStopSpinner() {
  if (termSpinnerInterval) { clearInterval(termSpinnerInterval); termSpinnerInterval = null; }
  if (_spinnerEl && _spinnerEl.parentNode) _spinnerEl.parentNode.removeChild(_spinnerEl);
  _spinnerEl = null;
}

// ════════════════════════════════════════════════════════
//  Rich Text Editor
// ════════════════════════════════════════════════════════
function rteCmd(cmd) {
  document.getElementById('opinion-editor').focus();
  document.execCommand(cmd, false, null);
  updateCharCount();
}

function rteClear() {
  document.getElementById('opinion-editor').innerHTML = '';
  updateCharCount();
}

function getEditorText() {
  var el = document.getElementById('opinion-editor');
  // Get plain text from the contenteditable div
  return el.innerText || el.textContent || '';
}

function updateCharCount() {
  var n = getEditorText().length;
  document.getElementById('char-count').textContent = n + ' / 2000';
}

function updateExtCharCount() {
  var n = document.getElementById('external-ai-input').value.length;
  document.getElementById('ext-char-count').textContent = n + ' / 10000';
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
      else { onConnected(accs[0], 'metamask'); }
    });
  }
  if (window.ethereum) { setup(window.ethereum); }
  else { window.addEventListener('ethereum#initialized', function() { setup(window.ethereum); }, { once: true }); }
}

function waitForEthereum(ms) {
  ms = ms || 3000;
  if (window.ethereum) return Promise.resolve(window.ethereum);
  return new Promise(function(resolve) {
    var done = false;
    function finish(v) { if (!done) { done = true; clearInterval(p); clearTimeout(t); resolve(v||null); } }
    var p = setInterval(function() { if (window.ethereum) finish(window.ethereum); }, 100);
    function onEv() { finish(window.ethereum); }
    window.addEventListener('ethereum#initialized', onEv, { once: true });
    var t = setTimeout(function() { finish(window.ethereum); }, ms);
  });
}

// ════════════════════════════════════════════════════════
//  Modal
// ════════════════════════════════════════════════════════
function openModal()  { document.getElementById('wallet-modal').classList.remove('hidden'); }
function closeModal() { document.getElementById('wallet-modal').classList.add('hidden'); }

// ════════════════════════════════════════════════════════
//  SDK loading
// ════════════════════════════════════════════════════════
async function _loadGL() {
  if (_gl && _chains) return;
  termLog('info', 'Loading GenLayer SDK…');
  termStartSpinner('Fetching SDK from esm.sh');
  try {
    var r = await Promise.all([
      import('https://esm.sh/genlayer-js@latest'),
      import('https://esm.sh/genlayer-js@latest/chains'),
    ]);
    _gl = r[0]; _chains = r[1];
    termStopSpinner();
    termLog('success', 'SDK loaded ✓');
  } catch (err) {
    termStopSpinner();
    throw new Error('SDK load failed: ' + err.message);
  }
}

function _buildClient() {
  var ep = proxyEndpoint || STUDIONET_DIRECT;
  termLog('info', 'Client → ' + ep);
  client = _gl.createClient({ chain: _chains.studionet, account: account, endpoint: ep });
}

// ════════════════════════════════════════════════════════
//  Wallet connect
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
    saveSession('auto', account.address, account.privateKey || null);
  } catch (err) {
    termLog('error', err.message); showToast(err.message, 'error');
  } finally { _setModalLoading(false, 'auto'); }
}

async function connectMetaMask() {
  _setModalLoading(true, 'metamask');
  try {
    await _loadGL();
    var provider = await waitForEthereum(4000);
    if (!provider) { throw new Error('MetaMask not detected. Install it and refresh.'); }
    var accs = await provider.request({ method: 'eth_requestAccounts' });
    if (!accs || !accs.length) throw new Error('No accounts returned.');
    account = _gl.createAccount();
    _buildClient();
    walletMode = 'metamask';
    attachMetaMaskListeners();
    closeModal();
    onConnected(accs[0], 'metamask');
    termLog('success', 'MetaMask: ' + accs[0]);
    showToast('MetaMask connected ✓', 'success');
    saveSession('metamask', accs[0], null);
  } catch (err) {
    if (err.code === 4001) err.message = 'Rejected by user.';
    termLog('error', err.message); showToast(err.message, 'error');
  } finally { _setModalLoading(false, 'metamask'); }
}

function disconnectWallet() {
  client = null; account = null; walletMode = null; currentOpinionId = null;
  document.getElementById('connect-label').textContent = 'Connect Wallet';
  document.getElementById('connect-dot').style.background = '';
  showEl('not-connected-msg'); hideEl('connected-form');
  hideEl('btn-disconnect');
  resetToStep('step-editor');
  termLog('info', 'Wallet disconnected.');
  clearSession();
}

function onConnected(address, mode) {
  var short = address.slice(0,6) + '…' + address.slice(-4);
  var label = (mode === 'metamask' ? '🦊 ' : '⚡ ') + short;
  document.getElementById('connect-label').textContent    = label;
  document.getElementById('connect-dot').style.background = 'var(--accent)';
  document.getElementById('connected-addr').textContent   = label;
  hideEl('not-connected-msg'); showEl('connected-form');
  showEl('btn-disconnect');
}

function _setModalLoading(on, which) {
  ['modal-auto-btn','modal-mm-btn'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.style.pointerEvents = on ? 'none' : '';
  });
  var id = which === 'auto' ? 'modal-auto-btn' : 'modal-mm-btn';
  var t  = document.getElementById(id)?.querySelector('.wallet-option-title');
  if (t) t.textContent = on ? 'Connecting…' : (which === 'auto' ? 'Auto Connect' : 'MetaMask');
}

// ════════════════════════════════════════════════════════
//  Step navigation helpers
// ════════════════════════════════════════════════════════
var STEPS = ['step-editor','step-validation-choice','step-external-ai','step-genlayer-eval'];

function showStep(id) {
  STEPS.forEach(function(s) {
    var el = document.getElementById(s);
    if (el) { if (s === id) el.classList.remove('hidden'); else el.classList.add('hidden'); }
  });
  // Also hide result cards on reset
  if (id === 'step-editor') {
    hideEl('ai-result'); hideEl('finalized-banner');
  }
}

function resetToStep(id) { showStep(id); }

// ════════════════════════════════════════════════════════
//  RPC read
// ════════════════════════════════════════════════════════
async function rpcRead(fn, args) {
  args = args || [];
  termLog('info', fn + '(' + args.join(', ') + ')');

  if (client) {
    try {
      var r = await client.readContract({ address: CONTRACT_ADDRESS, functionName: fn, args: args });
      termLog('success', fn + ' ✓');
      return r;
    } catch (err) {
      termLog('error', fn + ' failed: ' + err.message);
      throw err;
    }
  }

  // Fallback raw gen_call (boot reads before wallet connect)
  var body = JSON.stringify({
    jsonrpc: '2.0', id: Date.now(), method: 'gen_call',
    params: [{ from: ZERO_ADDR, to: CONTRACT_ADDRESS, type: 'read', data: { function: fn, args: args }, status: 'accepted' }],
  });
  try {
    var res  = await fetch(readEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body });
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
//  Contract write
// ════════════════════════════════════════════════════════
async function contractWrite(functionName, args) {
  args = args || [];
  if (!client) throw new Error('Connect your wallet first.');
  if (!proxyEndpoint) throw new Error('Open via server: run "node server.js" then go to http://localhost:3001');

  termLog('tx', 'writeContract → ' + functionName + '(' + args.map(function(a){ return String(a).slice(0,50); }).join(', ') + ')');
  termStartSpinner('Sending transaction to GenLayer');

  var txHash;
  try {
    txHash = await client.writeContract({ address: CONTRACT_ADDRESS, functionName: functionName, args: args, value: BigInt(0) });
  } catch (err) {
    termStopSpinner();
    var msg = err.message || String(err);
    if (msg.includes('is not valid JSON') || msg.includes('Unexpected token'))
      throw new Error('Studionet returned unexpected response. Try again in a moment.');
    if (msg.includes('NetworkError') || msg.includes('Failed to fetch'))
      throw new Error('Network error — open the app on your Vercel URL.');
    throw err;
  }

  termStopSpinner();
  termLog('tx', 'txHash: ' + txHash);
  termStartSpinner('Waiting for FINALIZED consensus (AI calls: 60–120s)');

  var receipt = await client.waitForTransactionReceipt({ hash: txHash, status: 'FINALIZED', interval: 5000, retries: 120, fullTransaction: true });

  termStopSpinner();

  var execResult = receipt && receipt.txExecutionResultName;
  if (execResult && execResult !== 'FINISHED_WITH_RETURN')
    throw new Error('Execution failed: ' + execResult);

  var result = null;
  if (receipt) result = receipt.result || receipt.return_value || receipt.returnValue || receipt.data || null;
  termLog('success', 'Finalized ✓ result: ' + JSON.stringify(result));
  termLog('info', 'Receipt keys: ' + (receipt ? Object.keys(receipt).join(', ') : 'null'));
  return { txHash: txHash, receipt: receipt, result: result };
}

// ════════════════════════════════════════════════════════
//  MAIN SUBMIT — step 1
// ════════════════════════════════════════════════════════
async function handleSubmit() {
  var text = getEditorText().trim();
  if (!text)               return showToast('Write something first.', 'error');
  if (text.length > 2000)  return showToast('Max 2000 characters.', 'error');
  if (!client)             { openModal(); return; }

  setLoading('submit', true);
  termLog('info', 'submit_opinion — ' + text.length + ' chars');

  try {
    var out       = await contractWrite('submit_opinion', [text]);
    var txHash    = out.txHash;
    var opinionId = null;
    var r         = out.result || out.receipt;
    if (r) {
      var raw = r.result || r.return_value || r.returnValue || r.data;
      if (raw !== null && raw !== undefined) opinionId = String(raw);
    }

    // Fallback: read from chain
    if (!opinionId || opinionId === 'null' || opinionId === 'undefined') {
      termLog('info', 'Reading ID from chain…');
      try {
        await new Promise(function(r){ setTimeout(r, 2000); });
        var total = await rpcRead('get_total_submissions', []);
        var n = parseInt(String(total), 10);
        if (!isNaN(n) && n > 0) opinionId = String(n - 1);
      } catch(_) {}
    }

    if (!opinionId || opinionId === 'null') opinionId = '0';
    currentOpinionId = opinionId;

    // Show opinion ID prominently in both terminal AND UI
    termLog('success', '══ Opinion submitted — ID: ' + opinionId + ' ══');
    termLog('tx',      'txHash: ' + txHash);

    // Update UI step — show big ID card + tx hash in page
    document.getElementById('choice-opinion-id').textContent = opinionId;
    var txEl = document.getElementById('choice-tx-hash');
    if (txEl) txEl.textContent = txHash;
    showStep('step-validation-choice');

    refreshTotalSubmissions();
    showToast('Submitted! Opinion ID: ' + opinionId, 'success');

  } catch (err) {
    termStopSpinner();
    termLog('error', err.message);
    showToast('Error: ' + err.message, 'error');
  } finally {
    setLoading('submit', false);
  }
}

// ════════════════════════════════════════════════════════
//  Validation choice handlers
// ════════════════════════════════════════════════════════
function chooseGenlayer() {
  termLog('info', 'Validation mode: GenLayer AI validators');
  showStep('step-genlayer-eval');
}

function chooseExternal() {
  termLog('info', 'Validation mode: External AI (user-provided)');
  showStep('step-external-ai');
}

function backToChoice() {
  showStep('step-validation-choice');
}

// ════════════════════════════════════════════════════════
//  GenLayer AI evaluation — step 3b
// ════════════════════════════════════════════════════════
async function triggerEvaluate() {
  if (!currentOpinionId) return showToast('No opinion to evaluate.', 'error');
  setLoading('eval', true);
  termLog('ai', 'evaluate_opinion(' + currentOpinionId + ') → GenLayer AI validators…');
  showToast('AI validators working… (60–120s)', 'success');

  try {
    await contractWrite('evaluate_opinion', [currentOpinionId]);
    var entry = await rpcRead('get_resolution_data', [currentOpinionId]);
    renderAiResponse(entry && entry.ai_response ? entry.ai_response : '', 'genlayer');
    showEl('ai-result');
    termLog('success', 'AI evaluation complete ◉');
    showToast('AI evaluation complete ◉', 'success');
  } catch (err) {
    termStopSpinner();
    termLog('error', err.message);
    showToast('Error: ' + err.message, 'error');
  } finally {
    setLoading('eval', false);
  }
}

// ════════════════════════════════════════════════════════
//  External AI submission — step 3a
// ════════════════════════════════════════════════════════
async function submitExternalAI() {
  if (!currentOpinionId) return showToast('No opinion to validate.', 'error');
  var analysis = document.getElementById('external-ai-input').value.trim();
  if (!analysis) return showToast('Paste your AI analysis first.', 'error');

  setLoading('ext', true);
  termLog('ai', 'submit_with_external_ai(' + currentOpinionId + ') — user-provided analysis');
  termLog('info', 'GenLayer will verify the structure, not re-run the AI');
  showToast('Validating your analysis on-chain…', 'success');

  try {
    var out   = await contractWrite('submit_with_external_ai', [currentOpinionId, analysis]);
    var entry = await rpcRead('get_resolution_data', [currentOpinionId]);
    renderAiResponse(entry && entry.ai_response ? entry.ai_response : '', 'external');
    showEl('ai-result');
    termLog('success', 'External AI analysis validated and stored on-chain ✓');
    showToast('External analysis validated on-chain ✓', 'success');
  } catch (err) {
    termStopSpinner();
    termLog('error', err.message);
    showToast('Error: ' + err.message, 'error');
  } finally {
    setLoading('ext', false);
  }
}

// ════════════════════════════════════════════════════════
//  Finalize
// ════════════════════════════════════════════════════════
async function finalizeOpinion() {
  if (!currentOpinionId) return showToast('No opinion to finalize.', 'error');
  var rec     = document.getElementById('ai-recommendation').textContent;
  var verdict = (rec && rec !== '—') ? rec : 'Verified by GenLayer consensus';
  setLoading('final', true);
  termLog('tx', 'finalize_opinion(' + currentOpinionId + ')');

  try {
    await contractWrite('finalize_opinion', [currentOpinionId, verdict]);
    showEl('finalized-banner');
    termLog('success', 'Opinion finalized on-chain ⛓');
    showToast('Finalized on-chain ⛓', 'success');
  } catch (err) {
    termStopSpinner();
    termLog('error', err.message);
    showToast('Error: ' + err.message, 'error');
  } finally {
    setLoading('final', false);
  }
}

// ════════════════════════════════════════════════════════
//  Lookup
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
    termLog('info',    '│ Source : ' + (data.source || 'genlayer'));
    termLog('info',    '│ Author : ' + (data.author || '—'));
    termLog('info',    '│ Text   : ' + String(data.text || '—').slice(0, 120));

    var ai = data.ai_response || '';
    if (ai) {
      try {
        var p = JSON.parse(ai);
        termLog('ai', '│ Summary       : ' + (p.summary || '—'));
        termLog('ai', '│ Sentiment     : ' + (p.sentiment || '—'));
        termLog('ai', '│ Confidence    : ' + Math.round(parseFloat(p.confidence_score || 0) * 100) + '%');
        termLog('ai', '│ Recommendation: ' + (p.ai_recommendation || '—'));
      } catch(_) { termLog('ai', '│ AI: ' + ai.slice(0, 120)); }
    } else {
      termLog('info', '│ AI Response: (not evaluated yet)');
    }
    if (data.verdict) termLog('success', '│ Verdict: ' + data.verdict);
    termLog('success', '└─────────────────────────────────────');
    showToast('Opinion #' + rawId + ' loaded', 'success');

    // Also render result directly in the page (more accessible than terminal)
    var card = document.getElementById('lookup-result-card');
    if (card && data) {
      var ai = data.ai_response || '';
      var aiHtml = '';
      if (ai) {
        try {
          var p = JSON.parse(ai);
          aiHtml =
            '<div class="lr-field"><span class="lr-key">📝 Summary</span><span class="lr-val">' + escapeHtml(p.summary || '—') + '</span></div>' +
            '<div class="lr-field"><span class="lr-key">🎭 Sentiment</span><span class="lr-val">' + escapeHtml(p.sentiment || '—') + '</span></div>' +
            '<div class="lr-field"><span class="lr-key">🎯 Confidence</span><span class="lr-val">' + Math.round(parseFloat(p.confidence_score||0)*100) + '%</span></div>' +
            '<div class="lr-field"><span class="lr-key">💡 Recommendation</span><span class="lr-val">' + escapeHtml(p.ai_recommendation || '—') + '</span></div>';
        } catch(_) { aiHtml = '<div class="lr-field"><span class="lr-key">AI</span><span class="lr-val">' + escapeHtml(ai.slice(0,200)) + '</span></div>'; }
      }
      card.innerHTML =
        '<div class="lr-header">' +
          '<span class="lr-id">#' + escapeHtml(String(data.id || rawId)) + '</span>' +
          '<span class="status-badge status-' + escapeHtml(data.status || 'pending') + '">' + escapeHtml(data.status || '—') + '</span>' +
          (data.source === 'external' ? '<span class="lr-source">🔗 External AI</span>' : '<span class="lr-source">⬡ GenLayer AI</span>') +
        '</div>' +
        '<div class="lr-field"><span class="lr-key">✍️ Text</span><span class="lr-val">' + escapeHtml(String(data.text||'—').slice(0,200)) + '</span></div>' +
        '<div class="lr-field"><span class="lr-key">👤 Author</span><span class="lr-val lr-mono">' + escapeHtml(String(data.author||'—').slice(0,20)) + '…</span></div>' +
        aiHtml +
        (data.verdict ? '<div class="lr-field"><span class="lr-key">⚖️ Verdict</span><span class="lr-val lr-accent">' + escapeHtml(data.verdict) + '</span></div>' : '');
      card.classList.remove('hidden');
    }
  } catch (err) {
    termLog('error', 'Lookup failed: ' + err.message);
    showToast('Error: ' + err.message, 'error');
  } finally {
    setLoading('lookup', false);
  }
}

// ════════════════════════════════════════════════════════
//  Total submissions
// ════════════════════════════════════════════════════════
async function refreshTotalSubmissions() {
  // Completely silent — errors/retries never shown in terminal
  // get_total_submissions can fail on new deploys; it's a non-critical stat
  for (var i = 0; i < 3; i++) {
    try {
      if (i > 0) await new Promise(function(r){ setTimeout(r, 3000); });
      // Bypass termLog by calling gen_call directly without logging
      var body = JSON.stringify({
        jsonrpc: '2.0', id: Date.now(), method: 'gen_call',
        params: [{ from: ZERO_ADDR, to: CONTRACT_ADDRESS, type: 'read',
                   data: { function: 'get_total_submissions', args: [] }, status: 'accepted' }],
      });
      var res  = await fetch(readEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body });
      var json = await res.json();
      if (!json.error) {
        var s = String(json.result);
        if (/^\d+$/.test(s)) {
          document.getElementById('stat-total').textContent = s;
          return;
        }
      }
    } catch(_) { /* silent */ }
  }
}

// ════════════════════════════════════════════════════════
//  Render AI response into UI
// ════════════════════════════════════════════════════════
function renderAiResponse(raw, source) {
  var data;
  try {
    data = JSON.parse((typeof raw === 'string' ? raw : JSON.stringify(raw)).replace(/```json|```/g, '').trim());
  } catch(_) {
    data = { summary: raw, sentiment:'—', category:'—', key_points:[], ai_recommendation: raw, confidence_score:'0' };
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

  // Update source badge
  var badge = document.getElementById('ai-source-badge');
  if (badge) {
    badge.textContent = source === 'external' ? '🔗 External AI validated' : '⬡ Consensus reached';
    badge.style.background = source === 'external' ? 'rgba(96,165,250,0.1)' : '';
    badge.style.color      = source === 'external' ? '#60a5fa' : '';
  }

  termLog('ai', 'AI analysis stored — source: ' + (source || 'genlayer'));

  // Render the consensus result card (frontend-only, computed from AI data)
  var conf = Math.round(parseFloat(data.confidence_score || 0) * 100);
  var sentiment = (data.sentiment || 'neutral').toLowerCase();
  var decision  = (sentiment === 'negative') ? 'REVIEWED' : 'APPROVED';
  var decEmoji  = (decision === 'APPROVED') ? '✅' : '🔍';
  var confEmoji = conf >= 80 ? '🟢' : conf >= 50 ? '🟡' : '🔴';
  var el = document.getElementById('consensus-result-card');
  if (el) {
    el.innerHTML =
      '<div class="cr-row"><span class="cr-label">🏛️ Consensus</span>' +
        '<span class="cr-value cr-green">Reached</span></div>' +
      '<div class="cr-row"><span class="cr-label">⚖️ Decision</span>' +
        '<span class="cr-value">' + decEmoji + ' ' + decision + '</span></div>' +
      '<div class="cr-row"><span class="cr-label">🎯 Confidence</span>' +
        '<span class="cr-value">' + confEmoji + ' ' + conf + '%</span></div>' +
      '<div class="cr-row"><span class="cr-label">📊 Sentiment</span>' +
        '<span class="cr-value">' + (data.sentiment || '—') + '</span></div>' +
      '<div class="cr-row"><span class="cr-label">🏷️ Category</span>' +
        '<span class="cr-value">' + (data.category || '—') + '</span></div>';
    el.classList.remove('hidden');
  }
}

// ════════════════════════════════════════════════════════
//  UI helpers
// ════════════════════════════════════════════════════════
function setLoading(a, on) {
  var s = document.getElementById(a + '-spinner');
  var l = document.getElementById(a + '-label');
  var b = s && s.closest('button');
  if (s) s.classList.toggle('hidden', !on);
  if (b) b.disabled = on;
  var m = {
    submit: ['Submit to GenLayer',        'Submitting…'],
    eval:   ['▶ Start AI Evaluation',     'Evaluating… (1–2 min)'],
    ext:    ['Validate on GenLayer',       'Validating…'],
    final:  ['⬡ Finalize on-chain',       'Finalizing…'],
    lookup: ['Read from Chain',            'Reading…'],
  };
  if (l && m[a]) l.textContent = on ? m[a][1] : m[a][0];
}

function showEl(id) { var e = document.getElementById(id); if (e) e.classList.remove('hidden'); }
function hideEl(id) { var e = document.getElementById(id); if (e) e.classList.add('hidden'); }
function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

var _toastT;
function showToast(msg, type) {
  var old = document.querySelector('.toast'); if (old) old.remove();
  clearTimeout(_toastT);
  var t = document.createElement('div');
  t.className   = 'toast' + (type ? ' toast-' + type : '');
  t.textContent = msg;
  document.body.appendChild(t);
  _toastT = setTimeout(function(){ t.remove(); }, 6000);
}
