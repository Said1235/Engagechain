# ◈ EngageChain

> **AI-Native Opinion Protocol — powered by GenLayer Intelligent Contracts**

Submit any opinion or proposal. AI validators evaluate it through multi-validator consensus, and the result is stored permanently on-chain. You choose whether GenLayer evaluates it or you bring your own AI.

[![GenLayer](https://img.shields.io/badge/Built%20on-GenLayer-00e5c3?style=flat-square)](https://genlayer.com)
[![Vercel](https://img.shields.io/badge/Deploy-Vercel-black?style=flat-square&logo=vercel)](https://vercel.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-white?style=flat-square)](LICENSE)

---

## What It Does

```
Submit opinion → Choose AI validator → Consensus → Verdict stored on-chain
```

1. **Submit** — rich text editor, up to 2000 characters, signed on-chain
2. **Choose validation** — GenLayer LLM consensus **or** your own AI analysis
3. **Evaluate** — AI produces structured analysis (summary, sentiment, key points, recommendation)
4. **Finalize** — verdict stored permanently with a unique on-chain ID
5. **Lookup** — anyone can query any opinion by ID, result shown directly in the page

---

## Run Locally

> Zero dependencies. Just Node.js ≥ 14.

```bash
git clone https://github.com/Said1235/Engagechain.git
cd Engagechain
node server.js
# Open http://localhost:3001
```

`server.js` serves the frontend **and** proxies `/api/rpc` to studionet — all features work locally including submit, evaluate, and finalize.

---

## Deploy to Vercel

```bash
# Option A — Vercel CLI
vercel deploy

# Option B — GitHub import
# Push to GitHub → vercel.com → New Project → import repo → Deploy
```

No environment variables needed. Vercel auto-detects `api/rpc.js` as a serverless function.

---

## Features (v3)

| Feature | Detail |
|---|---|
| 🖊️ Rich text editor | Bold, italic, underline, lists — contenteditable with toolbar |
| 🤖 Dual AI validation | GenLayer LLM consensus **or** paste your own AI analysis |
| 📊 Consensus card | Emoji result card: Consensus / Decision / Confidence |
| 🔍 In-page lookup | Opinion data displayed directly in the page, not just terminal |
| 💾 Session persistence | Wallet stays connected after page refresh (localStorage) |
| ⚡ Silent stats | Total submissions loads quietly without terminal noise |
| 📺 Resizable terminal | Drag the bottom handle to resize; toggle to collapse |

---

## Contract

**Address:** `0x7D361211C5C2cB0A6066D583527F45EaE544e468`  
**Network:** GenLayer Studionet  
**View in Studio:** [studio.genlayer.com](https://studio.genlayer.com/?import-contract=0x7D361211C5C2cB0A6066D583527F45EaE544e468)

### Methods

| Method | Type | Args | Returns |
|---|---|---|---|
| `submit_opinion` | write | `text: str` | opinion ID |
| `evaluate_opinion` | write | `opinion_id: str` | AI analysis object |
| `submit_with_external_ai` | write | `opinion_id: str, analysis: str` | normalized AI object |
| `finalize_opinion` | write | `opinion_id: str, verdict: str` | `{id, status}` |
| `get_total_submissions` | read | — | total count string |
| `get_resolution_data` | read | `opinion_id: str` | full opinion object |
| `get_status` | read | `opinion_id: str` | status string |
| `get_all_opinions` | read | — | all opinions dict |

---

## How AI Evaluation Works

```python
def get_analysis() -> str:
    raw = gl.nondet.exec_prompt(task)          # LLM call — non-deterministic block
    parsed = json.loads(raw)
    return json.dumps(parsed, sort_keys=True)  # deterministic for strict_eq

result_str  = gl.eq_principle.strict_eq(get_analysis)  # validators agree byte-for-byte
result_json = json.loads(result_str)                    # deserialize OUTSIDE nondet
```

Multiple validators independently run the same prompt. `strict_eq` confirms they all produced equivalent results. No single party controls the output.

---

## File Structure

```
api/
  rpc.js           Vercel serverless proxy → studionet (dual-port 443/8443)
contract/
  engagechain.py   GenLayer Intelligent Contract (Python)
app.js             Frontend logic
index.html         UI
styles.css         Styles
server.js          Local dev server (no npm install)
favicon.svg        EngageChain hexagon icon
vercel.json        maxDuration: 60s for AI consensus calls
package.json       Node 24.x engine pin
```

---

## Stack

| | |
|---|---|
| Smart Contract | Python · `py-genlayer:test` |
| Network | GenLayer Studionet |
| Frontend | Vanilla JS · HTML · CSS · Orbitron + Inter + Space Mono |
| Proxy | Node.js `https` module · dual-port retry (443 → 8443) |
| Deploy | Vercel Serverless Functions |

---

Built on [GenLayer](https://genlayer.com) · by [@Said1235](https://github.com/Said1235)
