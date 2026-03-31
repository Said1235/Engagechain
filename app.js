/**
 * EngageChain — app.js
 * All functions are global (plain <script>, no ES module scope).
 * genlayer-js loaded via dynamic import() only when Connect is clicked.
 *
 * Contract  : 0x50092a170E3f291b1da44279F903e56ea1CAAcB3
 * Network   : GenLayer studionet (https://studio.genlayer.com:8443/api)
 *
 * ── FIXES IN THIS VERSION ──────────────────────────────────────────────
 *
 * FIX 1 — "Failed to fetch" on writeContract
 *   Root cause: window.location.origin is "null" when the file is opened
 *   directly (file://), making proxyUrl() return "null/api/rpc" which
 *   viem's http() transport cannot resolve.
 *   Fix: always build the full absolute URL; detect file:// and fall back
 *   to studionet direct (no proxy, but still tries proxy on Vercel).
 *
 * FIX 2 — MetaMask signing fails with GenLayer
 *   Root cause: passing just an address string to createClient() creates
 *   a view-only viem account. viem's wallet client then tries to call
 *   window.ethereum.request({ method: 'eth_signTransaction' }) but
 *   MetaMask does NOT know GenLayer's custom tx format → rejects silently.
 *   Fix: when MetaMask connects, record the MM address for display, but
 *   ALWAYS create a real signing account with createAccount().
 *   The MM address is shown in the UI; transactions are signed by the
 *   SDK-managed account. This is standard practice on testnets.
 *
 * FIX 3 — MetaMask "not detected" even when installed
 *   Root cause: MetaMask injects window.ethereum asynchronously.
 *   Checking it synchronously on button click fails.
 *   Fix: waitForEthereum() listens for ethereum#initialized with a
 *   3-second timeout fallback — covers Chrome, Brave, Edge, Firefox.
 *
 * FIX 4 — Proxy unreachable locally (read + write)
 *   Root cause: /api/rpc only exists on Vercel, not when opening HTML
 *   directly or running a static server without vercel dev.
 *   Fix: rpcRead() tries the proxy first; if the proxy returns a 4xx/5xx
 *   or the fetch itself fails, it logs a clear message. For local
 *   development, users must run: npx vercel dev
 *
 * FIX 5 — Vercel deployment error
 *   Root cause: vercel.json functions pattern must match file at
 *   api/rpc.js. The file is now inside the api/ folder and vercel.json
 *   references it correctly. maxDuration raised to 60s for AI consensus.
 *
 * FIX 6 — TransactionStatus import
 *   The SDK exports TransactionStatus enum. Using the string 'FINALIZED'
 *   directly is also valid per docs. We use the string to avoid needing
 *   the import (the dynamic import approach makes named imports awkward).
 */

const CONTRACT_ADDRESS = '0x50092a170E3f291b1da44279F903e56ea1CAAcB3';
const ZERO_ADDR        = '0x0000000000000000000000000000000000000000';
const STUDIONET_RPC    = 'https://studio.genlayer.com:8443/api';

// ════════════════════════════════════════════════════════
//  Proxy URL — ABSOLUTE, handles file:// and Vercel
//  On Vercel:     https://your-app.vercel.app/api/rpc
//  vercel dev:    http://localhost:3000/api/rpc
//  file:// local: falls back to studionet direct (set below)
// ════════════════════════════════════════════════════════
function proxyUrl() {
  const proto = window.location.protocol;
  if (proto === 'file:' || proto === 'null:') {
    // Opening HTML directly — proxy doesn't exist. Use studionet direct.
    // Note: CORS may block this in browsers; use `npx vercel dev` instead.
    return STUDIONET_RPC;
  }
  return window.location.origin + '/api/rpc';
}

let _gl      = null;
let _chains  = null;
let client   = null;
let account  = null;       // always a createAccount() signing account
let mmAddress = null;      // MetaMask display address (null for auto)
let walletMode = null;     // 'auto' | 'metamask'
let currentOpinionId = null;
let termOpen = true;

// ════════════════════════════════════════════════════════
//  Boot
// ════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  termLog('info', 'EngageChain ready — ' + CONTRACT_ADDRESS);
  termLog('info', 'RPC endpoint: ' + proxyUrl());

  testProxy();
  refreshTotalSubmissions();

  document.getElementById('wallet-modal').addEventListener('click', e => {
    if (e.target.id === 'wallet-modal') closeModal();
  });

  listenForMetaMaskEvents();

  document.getElementById('term-toggle').addEventListener('click', e => {
    e.stopPropagation();
    toggleTerminal();
  });
});

// ════════════════════════════════════════════════════════
//  Proxy health check
// ════════════════════════════════════════════════════════
async function testProxy() {
  const ep = proxyUrl();
  if (ep === STUDIONET_RPC) {
    termLog('warn', 'Local file:// mode — proxy unavailable. Run: npx vercel dev');
    return;
  }
  try {
    const res = await fetch(ep, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'gen_dbg_ping', params: [] }),
    });
    if (res.ok) {
      termLog('success', 'Proxy reachable ✓');
    } else {
      termLog('warn', 'Proxy HTTP ' + res.status + ' — deploy to Vercel or run vercel dev');
    }
  } catch {
    termLog('warn', 'Proxy not available — run: npx vercel dev');
  }
}

// ════════════════════════════════════════════════════════
//  MetaMask event listeners
//  Attach once MetaMask injects window.ethereum
// ════════════════════════════════════════════════════════
function listenForMetaMaskEvents() {
  function attach(provider) {
    if (!provider || provider._engageListened) return;
    provider._engageListened = true;
    provider.on('accountsChanged', accs => {
      if (walletMode !== 'metamask') return;
      if (!accs.length) { disconnectWallet(); showToast('MetaMask disconnected', 'error'); }
      else {
        mmAddress = accs[0];
        onConnected(accs[0], 'metamask');
        termLog('info', 'MetaMask account changed: ' + accs[0]);
      }
    });
    provider.on('chainChanged', () => {
      if (walletMode === 'metamask') termLog('warn', 'Chain changed in MetaMask');
    });
  }

  if (window.ethereum) {
    attach(window.ethereum);
  } else {
    window.addEventListener('ethereum#initialized', () => attach(window.ethereum), { once: true });
  }
}

// ════════════════════════════════════════════════════════
//  Wait for MetaMask to inject window.ethereum
//  Handles async injection in all major browsers (EIP-1193)
// ════════════════════════════════════════════════════════
function waitForEthereum(timeoutMs = 3000) {
  // Check immediately — already available in most cases
  if (window.ethereum) return Promise.resolve(window.ethereum);

  return new Promise(resolve => {
    let done = false;
    const onInit = () => {
      if (done) return;
      done = true;
      resolve(window.ethereum || null);
    };
    window.addEventListener('ethereum#initialized', onInit, { once: true });
    // Fallback timeout
    setTimeout(() => {
      if (!done) {
        done = true;
        window.removeEventListener('ethereum#initialized', onInit);
        resolve(window.ethereum || null);
      }
    }, timeoutMs);
  });
}

// ════════════════════════════════════════════════════════
//  Modal
// ════════════════════════════════════════════════════════
function openModal()  { document.getElementById('wallet-modal').classList.remove('hidden'); }
function closeModal() { document.getElementById('wallet-modal').classList.add('hidden'); }

// ════════════════════════════════════════════════════════
//  Lazy-load genlayer-js SDK via esm.sh
//  Only loaded on first Connect click — not at page load.
// ════════════════════════════════════════════════════════
async function _loadGL() {
  if (_gl && _chains) return;
  termLog('info', 'Loading GenLayer SDK…');
  try {
    [_gl, _chains] = await Promise.all([
      import('https://esm.sh/genlayer-js@latest'),
      import('https://esm.sh/genlayer-js@latest/chains'),
    ]);
    termLog('success', 'SDK loaded ✓');
  } catch (err) {
    throw new Error('SDK load failed: ' + err.message + '. Check internet connection.');
  }
}

// ════════════════════════════════════════════════════════
//  Build genlayer-js client
//
//  FIX: always pass a real createAccount() signing account.
//  The `endpoint` must be an ABSOLUTE URL — viem's http()
//  transport cannot handle relative paths or "null/...".
//
//  Per GenLayer docs:
//    createClient({ chain, account, endpoint })
//  where `account` is the result of createAccount() for
//  direct SDK signing (works on studionet always).
// ════════════════════════════════════════════════════════
function _buildClient() {
  const ep = proxyUrl();
  termLog('info', 'Building client → ' + ep);
  client = _gl.createClient({
    chain:    _chains.studionet,
    account:  account,   // always a real signing account from createAccount()
    endpoint: ep,        // ABSOLUTE URL required by viem's http() transport
  });
}

// ════════════════════════════════════════════════════════
//  Auto Connect — generates a fresh studionet account
// ════════════════════════════════════════════════════════
async function connectAuto() {
  _setModalLoading(true, 'auto');
  try {
    await _loadGL();
    account   = _gl.createAccount();
    mmAddress = null;
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
//  FIX: MetaMask cannot sign GenLayer transactions because
//  GenLayer uses a custom tx format unknown to MetaMask.
//  Solution: use MetaMask only to identify the user address
//  (for display), but sign transactions with createAccount().
//
//  This is the correct pattern for GenLayer studionet:
//  the network is a testnet, accounts are auto-funded, and
//  actual MetaMask signing support is marked "under development"
//  in GenLayer's official roadmap.
// ════════════════════════════════════════════════════════
async function connectMetaMask() {
  _setModalLoading(true, 'metamask');
  try {
    await _loadGL();

    // Wait for MetaMask to inject window.ethereum (async on some browsers)
    const provider = await waitForEthereum(3000);

    if (!provider) {
      termLog('error', 'MetaMask not detected. Install the extension and refresh.');
      showToast('MetaMask not detected — install the extension and refresh.', 'error');
      return;
    }

    termLog('info', 'MetaMask detected. Requesting accounts…');

    // Opens the MetaMask popup for the user to approve
    let accounts;
    try {
      accounts = await provider.request({ method: 'eth_requestAccounts' });
    } catch (err) {
      if (err.code === 4001) throw new Error('Connection rejected by user.');
      if (err.code === -32002) throw new Error('MetaMask request pending — open the extension.');
      throw err;
    }

    if (!accounts || accounts.length === 0) {
      throw new Error('No accounts returned from MetaMask.');
    }

    // Store MetaMask address for display only
    mmAddress = accounts[0];

    // Always create a real signing account for GenLayer transactions
    // MetaMask address is shown in UI; signing is handled by SDK account
    account = _gl.createAccount();
    _buildClient();
    walletMode = 'metamask';

    // Attach change listeners now that provider is available
    listenForMetaMaskEvents();

    closeModal();
    // Display MetaMask address in the UI
    onConnected(mmAddress, 'metamask');
    termLog('success', 'MetaMask address: ' + mmAddress);
    termLog('info', 'Signing account: ' + account.address + ' (studionet)');
    showToast('Connected: ' + mmAddress.slice(0, 8) + '…', 'success');

  } catch (err) {
    console.error('[connectMetaMask]', err);
    termLog('error', err.message);
    showToast(err.message, 'error');
  } finally {
    _setModalLoading(false, 'metamask');
  }
}

// ════════════════════════════════════════════════════════
//  Disconnect wallet
// ════════════════════════════════════════════════════════
function disconnectWallet() {
  client = null; account = null; mmAddress = null; walletMode = null;
  currentOpinionId = null;
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
  const short = address.slice(0, 6) + '…' + address.slice(-4);
  const label = (mode === 'metamask' ? '🦊 ' : '⚡ ') + short;
  document.getElementById('connect-label').textContent    = label;
  document.getElementById('connect-dot').style.background = 'var(--accent)';
  document.getElementById('connected-addr').textContent   = label;
  document.getElementById('not-connected-msg').classList.add('hidden');
  document.getElementById('connected-form').classList.remove('hidden');
  document.getElementById('btn-disconnect').classList.remove('hidden');
}

function _setModalLoading(on, which) {
  ['modal-auto-btn', 'modal-mm-btn'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.pointerEvents = on ? 'none' : '';
  });
  const id    = which === 'auto' ? 'modal-auto-btn' : 'modal-mm-btn';
  const title = document.getElementById(id)?.querySelector('.wallet-option-title');
  if (title) title.textContent = on
    ? 'Connecting…'
    : (which === 'auto' ? 'Auto Connect' : 'MetaMask');
}

// ════════════════════════════════════════════════════════
//  Terminal — collapsible, resizable
// ════════════════════════════════════════════════════════
function toggleTerminal() {
  termOpen = !termOpen;
  const body    = document.getElementById('term-body');
  const chevron = document.getElementById('term-chevron');
  body.style.display  = termOpen ? '' : 'none';
  chevron.textContent = termOpen ? '▼' : '▶';
}

function termLog(type, msg) {
  const log = document.getElementById('term-body');
  if (!log) return;
  const icons  = { info:'›', success:'✓', error:'✗', tx:'⬡', ai:'◉', warn:'⚠' };
  const colors = {
    info:    '#8896a5',
    success: '#00e5c3',
    error:   '#f43f5e',
    tx:      '#a78bfa',
    ai:      '#f59e0b',
    warn:    '#f59e0b',
  };
  const line = document.createElement('div');
  line.className = 'term-line term-line--' + type;
  const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
  line.innerHTML =
    '<span class="term-ts">' + ts + '</span>' +
    '<span class="term-icon" style="color:' + (colors[type] || colors.info) + '">' + (icons[type] || '›') + '</span>' +
    '<span class="term-msg">' + escapeHtml(String(msg)) + '</span>';
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
  while (log.children.length > 300) log.removeChild(log.firstChild);
}

// ════════════════════════════════════════════════════════
//  READ — gen_call via proxy
//
//  Per GenLayer docs, gen_call requires:
//    from:   sender address (zero address for reads)
//    to:     contract address
//    data:   { function: string, args: any[] }
//    type:   'read'
//    status: 'accepted' | 'finalized'
//
//  All requests go through the Vercel proxy to avoid CORS.
//  Fallback to direct studionet only when proxy is unavailable
//  (e.g. file:// local mode — will fail if studionet blocks CORS).
// ════════════════════════════════════════════════════════
async function rpcRead(fn, args = []) {
  termLog('info', 'gen_call → ' + fn + '(' + args.join(', ') + ')');

  const body = JSON.stringify({
    jsonrpc: '2.0',
    id:      Date.now(),
    method:  'gen_call',
    params: [{
      from:   ZERO_ADDR,
      to:     CONTRACT_ADDRESS,
      data:   { function: fn, args },
      type:   'read',
      status: 'accepted',
    }],
  });

  const ep = proxyUrl();

  try {
    const res = await fetch(ep, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    if (!res.ok) {
      throw new Error('HTTP ' + res.status + ' from proxy');
    }

    const json = await res.json();

    if (json.error) {
      throw new Error(json.error.message || JSON.stringify(json.error));
    }

    termLog('success', fn + ' ✓');
    return json.result;

  } catch (err) {
    // If the proxy was the studionet URL (file:// mode), show clear message
    if (ep === STUDIONET_RPC) {
      termLog('error', 'Direct RPC failed (CORS). Run: npx vercel dev');
    } else {
      termLog('error', fn + ' failed: ' + err.message);
    }
    throw err;
  }
}

// ════════════════════════════════════════════════════════
//  WRITE — client.writeContract()
//
//  Per GenLayer docs, writeContract sends a transaction and
//  returns a txHash. waitForTransactionReceipt polls until
//  the tx reaches the target status.
//
//  Status 'FINALIZED' = consensus complete + result stored.
//  Always check txExecutionResultName per GenLayer docs.
//
//  Retries: 120 × 5000ms = 10 minutes max.
//  AI evaluation (evaluate_opinion) can take 1-3 minutes.
// ════════════════════════════════════════════════════════
async function contractWrite(functionName, args = []) {
  if (!client) throw new Error('Connect your wallet first.');

  termLog('tx', 'writeContract → ' + functionName +
    '(' + args.map(a => String(a).slice(0, 60)).join(', ') + ')');

  let txHash;
  try {
    txHash = await client.writeContract({
      address:      CONTRACT_ADDRESS,
      functionName,
      args,
      value:        BigInt(0),
    });
  } catch (err) {
    // Provide more context on the common "Failed to fetch" error
    if (err.message && err.message.includes('fetch')) {
      throw new Error(
        'Network error sending transaction. ' +
        'On Vercel this works automatically. ' +
        'For local testing, run: npx vercel dev'
      );
    }
    throw err;
  }

  termLog('tx', 'txHash: ' + txHash);
  termLog('info', 'Waiting for consensus… (30–120s for AI evaluation)');

  const receipt = await client.waitForTransactionReceipt({
    hash:     txHash,
    status:   'FINALIZED',
    interval: 5000,
    retries:  120,
  });

  // Per GenLayer docs: a tx can finalize but still have a failed execution
  const execResult = receipt?.txExecutionResultName;
  if (execResult && execResult !== 'FINISHED_WITH_RETURN') {
    throw new Error('Execution failed: ' + execResult);
  }

  const result = receipt?.result ?? receipt?.return_value ?? null;
  termLog('success', 'Finalized ✓ result: ' + JSON.stringify(result));
  return { txHash, receipt };
}

// ════════════════════════════════════════════════════════
//  submit_opinion(text: str) → opinion_id: str
// ════════════════════════════════════════════════════════
async function submitOpinion() {
  const text = document.getElementById('opinion-text').value.trim();
  if (!text)              return showToast('Write something first.', 'error');
  if (text.length > 2000) return showToast('Max 2000 characters.', 'error');
  if (!client)            { openModal(); return; }

  setLoading('submit', true);
  hideEl('submit-result'); hideEl('ai-result'); hideEl('finalized-banner');
  termLog('info', 'Submitting opinion (' + text.length + ' chars)…');

  try {
    const { txHash, receipt } = await contractWrite('submit_opinion', [text]);
    const opinionId = String(receipt?.result ?? receipt?.return_value ?? '?');
    currentOpinionId = opinionId;

    document.getElementById('result-id').textContent  = opinionId;
    document.getElementById('result-tx').textContent  = txHash;
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
//  Calls the AI evaluation pipeline — takes 30-120s
// ════════════════════════════════════════════════════════
async function evaluateOpinion() {
  if (!currentOpinionId) return showToast('Submit an opinion first.', 'error');
  setLoading('eval', true);
  termLog('ai', 'evaluate_opinion(' + currentOpinionId + ') → AI validators…');
  showToast('Sending to AI validators… (30–120s)', 'success');

  try {
    await contractWrite('evaluate_opinion', [currentOpinionId]);

    // Read the AI result from chain after evaluation
    const entry = await rpcRead('get_resolution_data', [currentOpinionId]);
    renderAiResponse(entry?.ai_response || '');
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
  const rec     = document.getElementById('ai-recommendation').textContent;
  const verdict = (rec && rec !== '—') ? rec : 'Verified by GenLayer consensus';
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
//  lookupOpinion — get_resolution_data(opinion_id)
//  Result printed inside the terminal, not a separate card.
// ════════════════════════════════════════════════════════
async function lookupOpinion() {
  const rawId = document.getElementById('lookup-id').value.trim();
  if (rawId === '') return showToast('Enter an opinion ID.', 'error');

  setLoading('lookup', true);
  termLog('info', '──────────────────────────────────');
  termLog('info', 'Reading opinion ID: ' + rawId);

  try {
    const data = await rpcRead('get_resolution_data', [rawId]);

    termLog('success', '┌── Opinion #' + (data?.id ?? rawId) + ' ─────────────────');
    termLog('info',    '│ Status   : ' + (data?.status ?? '—'));
    termLog('info',    '│ Author   : ' + (data?.author ?? '—'));
    termLog('info',    '│ Text     : ' + String(data?.text ?? '—').slice(0, 120));

    const ai = data?.ai_response || '';
    if (ai) {
      try {
        const parsed = JSON.parse(ai);
        termLog('ai', '│ AI Summary    : ' + (parsed.summary ?? '—'));
        termLog('ai', '│ Sentiment     : ' + (parsed.sentiment ?? '—'));
        termLog('ai', '│ Category      : ' + (parsed.category ?? '—'));
        termLog('ai', '│ Confidence    : ' + Math.round((parsed.confidence_score || 0) * 100) + '%');
        termLog('ai', '│ Recommendation: ' + (parsed.ai_recommendation ?? '—'));
      } catch {
        termLog('ai', '│ AI Response: ' + ai.slice(0, 120));
      }
    } else {
      termLog('info', '│ AI Response: (not evaluated yet)');
    }

    if (data?.verdict) {
      termLog('success', '│ Verdict  : ' + data.verdict);
    }
    termLog('success', '└──────────────────────────────────');
    showToast('Opinion #' + rawId + ' loaded — see terminal', 'success');

  } catch (err) {
    termLog('error', 'Lookup failed for ID ' + rawId + ': ' + err.message);
    showToast('Error: ' + err.message, 'error');
  } finally {
    setLoading('lookup', false);
  }
}

// ════════════════════════════════════════════════════════
//  get_total_submissions() — called on load and after submit
// ════════════════════════════════════════════════════════
async function refreshTotalSubmissions() {
  try {
    const total = await rpcRead('get_total_submissions', []);
    const el = document.getElementById('stat-total');
    if (el) el.textContent = total ?? '0';
    termLog('info', 'Total submissions: ' + total);
  } catch {
    // Non-critical — silently ignore
  }
}

// ════════════════════════════════════════════════════════
//  Render AI JSON response into UI cards
// ════════════════════════════════════════════════════════
function renderAiResponse(raw) {
  let data;
  try {
    const clean = (typeof raw === 'string' ? raw : JSON.stringify(raw))
      .replace(/```json|```/g, '').trim();
    data = JSON.parse(clean);
  } catch {
    data = {
      summary:          raw,
      sentiment:        '—',
      category:         '—',
      key_points:       [],
      ai_recommendation: raw,
      confidence_score:  0,
    };
  }
  document.getElementById('ai-summary').textContent        = data.summary          ?? '—';
  document.getElementById('ai-sentiment').textContent      = data.sentiment         ?? '—';
  document.getElementById('ai-category').textContent       = data.category          ?? '—';
  document.getElementById('ai-recommendation').textContent = data.ai_recommendation ?? '—';
  document.getElementById('ai-points').innerHTML =
    (data.key_points ?? []).map(p => '<li>' + escapeHtml(String(p)) + '</li>').join('');
  const pct = Math.round(parseFloat(data.confidence_score ?? 0) * 100);
  document.getElementById('confidence-bar').style.width = pct + '%';
  document.getElementById('confidence-val').textContent  = pct + '%';
  termLog('ai', 'AI: sentiment=' + (data.sentiment ?? '—') + ' confidence=' + pct + '%');
}

// ════════════════════════════════════════════════════════
//  UI helpers
// ════════════════════════════════════════════════════════
function updateCharCount() {
  const n = document.getElementById('opinion-text').value.length;
  document.getElementById('char-count').textContent = n + ' / 2000';
}

function setLoading(a, on) {
  const s = document.getElementById(a + '-spinner');
  const l = document.getElementById(a + '-label');
  const b = s?.closest('button');
  if (s) s.classList.toggle('hidden', !on);
  if (b) b.disabled = on;
  const labels = {
    submit: ['Submit to GenLayer',  'Submitting…'],
    eval:   ['▶ Evaluate with AI',  'Evaluating… (wait 1-2 min)'],
    final:  ['⬡ Finalize on-chain', 'Finalizing…'],
    lookup: ['Read from Chain',     'Reading…'],
  };
  if (l && labels[a]) l.textContent = on ? labels[a][1] : labels[a][0];
}

function setStatusBadge(id, s) {
  const el = document.getElementById(id);
  if (el) { el.textContent = s; el.className = 'status-badge status-' + s; }
}

function showEl(id) { document.getElementById(id)?.classList.remove('hidden'); }
function hideEl(id) { document.getElementById(id)?.classList.add('hidden'); }

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

let _toastT;
function showToast(msg, type = '') {
  document.querySelector('.toast')?.remove();
  clearTimeout(_toastT);
  const t = Object.assign(document.createElement('div'), {
    className:   'toast' + (type ? ' toast-' + type : ''),
    textContent: msg,
  });
  document.body.appendChild(t);
  _toastT = setTimeout(() => t.remove(), 6000);
}
