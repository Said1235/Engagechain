# ◈ EngageChain

**AI-Native Opinion Protocol built on GenLayer Intelligent Contracts**

Submit any opinion or proposal. AI validators evaluate it, reach consensus through Optimistic Democracy, and the result is stored permanently on-chain.

[![Live Demo](https://img.shields.io/badge/Live%20Demo-Vercel-black?style=flat-square&logo=vercel)](https://engagechain.vercel.app)
[![GenLayer](https://img.shields.io/badge/Built%20on-GenLayer-00e5c3?style=flat-square)](https://genlayer.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-white?style=flat-square)](LICENSE)

---

## What It Does

1. **Submit** — Write any opinion, proposal, or dispute (up to 2000 characters)
2. **Evaluate** — The Intelligent Contract calls an LLM to analyze the text; multiple validators reach consensus via the Equivalence Principle
3. **Finalize** — The AI verdict is stored permanently on-chain with a unique ID

---

## Tech Stack

| Layer | Technology |
|---|---|
| Intelligent Contract | Python · GenLayer SDK (`py-genlayer`) |
| Contract Network | GenLayer Studionet |
| Frontend | Vanilla JS · HTML · CSS |
| Wallet | MetaMask (display) · GenLayer SDK account (signing) |
| RPC Proxy | Vercel Serverless Function (Node.js) |
| Local Dev Server | `server.js` (pure Node.js, zero dependencies) |

---

## Project Structure

```
engagechain/
├── api/
│   └── rpc.js              # Vercel serverless proxy → studionet
├── contract/
│   └── engagechain.py      # GenLayer Intelligent Contract
├── app.js                  # Frontend logic
├── index.html              # UI
├── styles.css              # Styles
├── server.js               # Local dev server (no npm needed)
├── favicon.svg             # EngageChain icon
├── vercel.json             # Vercel config (maxDuration: 60s)
└── package.json            # Node 24.x engine pin
```

---

## Contract

**Address:** `0x102625d1C7329faD69057744B38e2C924afd3dB4`  
**Network:** GenLayer Studionet  
**Studio:** [Open in Studio](https://studio.genlayer.com/?import-contract=0x102625d1C7329faD69057744B38e2C924afd3dB4)

### Methods

| Type | Method | Parameters | Description |
|---|---|---|---|
| Write | `submit_opinion` | `text: str` | Submits an opinion, returns its ID |
| Write | `evaluate_opinion` | `opinion_id: str` | Runs AI evaluation via GenLayer LLM |
| Write | `finalize_opinion` | `opinion_id: str, verdict: str` | Stores the final verdict on-chain |
| Read | `get_total_submissions` | — | Returns total number of submissions |
| Read | `get_resolution_data` | `opinion_id: str` | Returns full data for one opinion |
| Read | `get_status` | `opinion_id: str` | Returns current status |
| Read | `get_all_opinions` | — | Returns all submitted opinions |

---

## Running Locally

> **Requirements:** Node.js ≥ 14 installed. No `npm install` needed.

```bash
# Clone the repo
git clone https://github.com/Said1235/Engagechain.git
cd Engagechain

# Start the local server (serves files + proxies RPC)
node server.js

# Open in browser
open http://localhost:3001
```

The local server handles everything — static files and the `/api/rpc` proxy to studionet — so **all features work locally** including submit, evaluate, and finalize.

---

## Deploying to Vercel

1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com) → **Add New Project** → import the repo
3. No environment variables needed — deploy as-is
4. Vercel auto-detects `api/rpc.js` as a serverless function

The proxy at `/api/rpc` is required for writes (browsers can't reach `studio.genlayer.com:8443` directly due to CORS).

---

## Updating the Contract Address

If you redeploy the contract in GenLayer Studio, update line 1 of `app.js`:

```js
const CONTRACT_ADDRESS = '0xYOUR_NEW_ADDRESS_HERE';
```

---

## How the AI Evaluation Works

The contract calls `gl.nondet.exec_prompt()` inside a non-deterministic block. Multiple validators independently run the same LLM prompt. The `gl.eq_principle.strict_eq()` method compares results byte-for-byte after serializing to `json.dumps(result, sort_keys=True)` — a deterministic string that all validators can agree on.

```python
def get_analysis() -> str:
    result = gl.nondet.exec_prompt(task).strip()
    parsed = json.loads(result)
    return json.dumps(parsed, sort_keys=True)  # deterministic for strict_eq

result_str  = gl.eq_principle.strict_eq(get_analysis)
result_json = json.loads(result_str)  # deserialize OUTSIDE the nondet block
```

---

## License

MIT — see [LICENSE](LICENSE)

---

Built with ❤️ on [GenLayer](https://genlayer.com) · [GitHub](https://github.com/Said1235/Engagechain.git)
