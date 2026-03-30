/**
 * EngageChain — app.js
 * Uses genlayer-js with chain: studionet + createAccount()
 * On studionet, accounts are auto-generated and auto-funded.
 * Docs: https://docs.genlayer.com/api-references/genlayer-js
 */

const CONTRACT_ADDRESS = '0xb7c3197b59f72179ea00b505ba01ea96e58d917afc27bb8625f3a101c69ca722';

let client  = null;
let account = null;
let currentOpinionId = null;

// ══════════════════════════════════════════════════════
//  Boot
// ══════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  refreshTotalSubmissions();

  document.getElementById('wallet-modal').addEventListener('click', e => {
    if (e.target.id === 'wallet-modal') closeModal();
  });
});

// ══════════════════════════════════════════════════════
//  Wallet modal — one click, no private key needed
// ══════════════════════════════════════════════════════
function openModal() { showEl('wallet-modal'); }
function closeModal() { hideEl('wallet-modal'); }

async function confirmConnect() {
  const btn = document.getElementById('modal-connect-btn');
  btn.disabled = true;
  btn.textContent = 'Connecting…';

  try {
    // genlayer-js loaded via CDN — uses ESM build via unpkg
    const gl = window.genlayerJs;

    // createAccount() generates a new wallet
    // On studionet this account is automatically funded
    account = gl.createAccount();

    client = gl.createClient({
      chain:   gl.chains.studionet,   // studionet = studio.genlayer.com
      account: account,
    });

    closeModal();
    onConnected();
    showToast('Wallet connected ✓', 'success');

  } catch (err) {
    console.error('[connect]', err);
    showToast('Error: ' + err.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Connect';
  }
}

function onConnected() {
  const addr  = account?.address || '';
  const short = addr.length > 10 ? addr.slice(0,6) + '…' + addr.slice(-4) : 'Connected';

  document.getElementById('connect-label').textContent = short;
  document.getElementById('connect-dot').style.background = 'var(--accent)';
  document.getElementById('connected-addr').textContent = short;

  hideEl('not-connected-msg');
  showEl('connected-form');
}

// ══════════════════════════════════════════════════════
//  Read — no account needed, use raw RPC proxy
// ══════════════════════════════════════════════════════
async function rpcRead(fn, args = []) {
  const res = await fetch('/api/rpc', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'gen_call',
      params: [{ to: CONTRACT_ADDRESS, data: { function: fn, args } }],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data.result;
}

// ══════════════════════════════════════════════════════
//  Write — uses genlayer-js client (handles signing)
// ══════════════════════════════════════════════════════
async function contractWrite(functionName, args = []) {
  if (!client) throw new Error('Connect your wallet first.');

  const txHash = await client.writeContract({
    address:      CONTRACT_ADDRESS,
    functionName,
    args,
    value: BigInt(0),
  });

  showToast('Transaction sent — waiting for finalization…', 'success');

  const receipt = await client.waitForTransactionReceipt({
    hash:     txHash,
    status:   'FINALIZED',
    interval: 3000,
    retries:  60,
  });

  return { txHash, receipt };
}

// ══════════════════════════════════════════════════════
//  Contract actions
// ══════════════════════════════════════════════════════
async function submitOpinion() {
  const text = document.getElementById('opinion-text').value.trim();
  if (!text)              return showToast('Write something first.', 'error');
  if (text.length > 2000) return showToast('Too long (max 2000 chars).', 'error');
  if (!client)            return (openModal(), showToast('Connect your wallet first.', 'error'));

  setLoading('submit', true);
  hideEl('submit-result'); hideEl('ai-result'); hideEl('finalized-banner');

  try {
    const { txHash, receipt } = await contractWrite('submit_opinion', [text]);
    const opinionId = String(receipt?.result ?? receipt?.return_value ?? '0');
    currentOpinionId = opinionId;

    document.getElementById('result-id').textContent = opinionId;
    document.getElementById('result-tx').textContent = txHash;
    setStatusBadge('result-status', 'pending');
    showEl('submit-result');
    refreshTotalSubmissions();
    showToast(`Submitted! ID: ${opinionId}`, 'success');

  } catch (err) {
    showToast('Error: ' + err.message, 'error');
    console.error('[submit_opinion]', err);
  } finally {
    setLoading('submit', false);
  }
}

async function evaluateOpinion() {
  if (!currentOpinionId) return showToast('Submit an opinion first.', 'error');
  setLoading('eval', true);
  showToast('Sending to AI validators… ~30–60 seconds.', 'success');

  try {
    await contractWrite('evaluate_opinion', [currentOpinionId]);
    const entry = await rpcRead('get_resolution_data', [currentOpinionId]);
    renderAiResponse(entry?.ai_response || '');
    setStatusBadge('result-status', 'evaluated');
    showEl('ai-result');
    showToast('AI evaluation complete ◉', 'success');

  } catch (err) {
    showToast('Error: ' + err.message, 'error');
    console.error('[evaluate_opinion]', err);
  } finally {
    setLoading('eval', false);
  }
}

async function finalizeOpinion() {
  if (!currentOpinionId) return showToast('No opinion to finalize.', 'error');
  const rec     = document.getElementById('ai-recommendation').textContent;
  const verdict = (rec && rec !== '—') ? rec : 'Verified by GenLayer consensus';

  setLoading('final', true);
  try {
    await contractWrite('finalize_opinion', [currentOpinionId, verdict]);
    setStatusBadge('result-status', 'finalized');
    showEl('finalized-banner');
    showToast('Finalized on-chain ⛓', 'success');
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
    console.error('[finalize_opinion]', err);
  } finally {
    setLoading('final', false);
  }
}

async function lookupOpinion() {
  const rawId = document.getElementById('lookup-id').value.trim();
  if (!rawId) return showToast('Enter an opinion ID.', 'error');

  setLoading('lookup', true);
  hideEl('lookup-result');
  try {
    const data = await rpcRead('get_resolution_data', [rawId]);
    document.getElementById('lc-id').textContent      = data?.id     ?? rawId;
    document.getElementById('lc-author').textContent  = data?.author ?? '—';
    document.getElementById('lc-text').textContent    = data?.text   ?? '—';
    document.getElementById('lc-verdict').textContent = data?.verdict || '(not finalized)';
    document.getElementById('lc-status').innerHTML    = statusBadgeHTML(data?.status ?? '—');
    let ai = data?.ai_response || '';
    try { const p = JSON.parse(ai); ai = p.summary || ai; } catch (_) {}
    document.getElementById('lc-ai').textContent = ai || '(not evaluated yet)';
    showEl('lookup-result');
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  } finally {
    setLoading('lookup', false);
  }
}

async function refreshTotalSubmissions() {
  try {
    const total = await rpcRead('get_total_submissions', []);
    document.getElementById('stat-total').textContent = total ?? '0';
  } catch (_) {}
}

// ══════════════════════════════════════════════════════
//  Render AI response
// ══════════════════════════════════════════════════════
function renderAiResponse(raw) {
  let data;
  try {
    const clean = (typeof raw === 'string' ? raw : JSON.stringify(raw))
      .replace(/```json|```/g,'').trim();
    data = JSON.parse(clean);
  } catch (_) {
    data = { summary: raw, sentiment:'—', category:'—', key_points:[], ai_recommendation: raw, confidence_score: 0 };
  }
  document.getElementById('ai-summary').textContent        = data.summary          ?? '—';
  document.getElementById('ai-sentiment').textContent      = data.sentiment         ?? '—';
  document.getElementById('ai-category').textContent       = data.category          ?? '—';
  document.getElementById('ai-recommendation').textContent = data.ai_recommendation ?? '—';
  document.getElementById('ai-points').innerHTML =
    (data.key_points ?? []).map(p => `<li>${escapeHtml(String(p))}</li>`).join('');
  const pct = Math.round(parseFloat(data.confidence_score ?? 0) * 100);
  document.getElementById('confidence-bar').style.width = pct + '%';
  document.getElementById('confidence-val').textContent  = pct + '%';
}

// ══════════════════════════════════════════════════════
//  UI helpers
// ══════════════════════════════════════════════════════
function updateCharCount() {
  document.getElementById('char-count').textContent =
    `${document.getElementById('opinion-text').value.length} / 2000`;
}
function setLoading(a, on) {
  const s = document.getElementById(`${a}-spinner`);
  const l = document.getElementById(`${a}-label`);
  const b = s?.closest('button');
  if (s) s.classList.toggle('hidden', !on);
  if (b) b.disabled = on;
  const m = {
    submit: ['Submit to GenLayer','Submitting…'],
    eval:   ['▶ Evaluate with AI','Evaluating…'],
    final:  ['⬡ Finalize on-chain','Finalizing…'],
    lookup: ['Read','Reading…'],
  };
  if (l && m[a]) l.textContent = on ? m[a][1] : m[a][0];
}
function setStatusBadge(id, s) {
  const el = document.getElementById(id);
  if (el) { el.textContent = s; el.className = `status-badge status-${s}`; }
}
function statusBadgeHTML(s) { return `<span class="status-badge status-${s}">${s}</span>`; }
function showEl(id) { document.getElementById(id)?.classList.remove('hidden'); }
function hideEl(id) { document.getElementById(id)?.classList.add('hidden'); }
function escapeHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

let _t;
function showToast(msg, type='') {
  document.querySelector('.toast')?.remove(); clearTimeout(_t);
  const t = Object.assign(document.createElement('div'), {
    className: `toast ${type ? 'toast-' + type : ''}`,
    textContent: msg,
  });
  document.body.appendChild(t);
  _t = setTimeout(() => t.remove(), 5000);
}
