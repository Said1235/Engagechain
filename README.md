# ◈ EngageChain

> **Intelligent Contract de opinión y validación AI en GenLayer.**
> El usuario envía texto → la IA evalúa → los validadores consensúan → el resultado queda on-chain.

---

## ¿Qué es EngageChain?

EngageChain es un [Intelligent Contract](https://docs.genlayer.com/intelligent-contracts/overview) construido sobre GenLayer que convierte opiniones subjetivas en veredictos verificables on-chain mediante IA y consenso descentralizado.

### Flujo del protocolo

```
✍ Human Input  →  ◉ AI Evaluation  →  ⬡ Optimistic Democracy  →  ⛓ On-Chain Record
```

1. **Human Input** — el usuario envía una opinión, propuesta o disputa
2. **AI Evaluation** — el contrato llama al LLM vía `gl.exec_prompt()` para analizar el texto
3. **Optimistic Democracy** — los validadores de GenLayer ejecutan el mismo prompt y comparan resultados con la *Equivalence Principle*
4. **On-Chain Record** — el veredicto consensuado queda guardado de forma permanente e inmutable

---

## Estructura del proyecto

```
engagechain/
├── contract/
│   └── engagechain.py      ← Intelligent Contract (Python + GenLayer SDK)
├── frontend/
│   ├── index.html          ← Landing + demo UI
│   ├── app.js              ← Lógica: GenLayerJS + RPC directo (fallback)
│   └── styles.css          ← Estilos (dark industrial aesthetic)
└── README.md
```

---

## Contrato: `contract/engagechain.py`

Escrito en Python con el [GenLayer SDK](https://docs.genlayer.com/intelligent-contracts/sdk-reference).

### Estado persistente

| Campo               | Tipo                   | Descripción                          |
|---------------------|------------------------|--------------------------------------|
| `submissions`       | `TreeMap[u256, str]`   | Texto original de cada opinión       |
| `ai_responses`      | `TreeMap[u256, str]`   | Respuesta JSON generada por la IA    |
| `verdicts`          | `TreeMap[u256, str]`   | Veredicto final consensuado          |
| `authors`           | `TreeMap[u256, str]`   | Dirección del autor                  |
| `statuses`          | `TreeMap[u256, str]`   | `pending` / `evaluated` / `finalized`|
| `timestamps`        | `TreeMap[u256, u256]`  | Bloque lógico de la entrada          |
| `total_submissions` | `u256`                 | Contador global de entradas          |

### Funciones públicas

| Función                              | Tipo    | Descripción                                      |
|--------------------------------------|---------|--------------------------------------------------|
| `submit_opinion(text)`               | `write` | Registra una nueva opinión, devuelve ID          |
| `evaluate_opinion(id)`               | `write` | Llama al LLM para evaluar (no determinista)      |
| `store_ai_response(id, response)`    | `write` | Guarda respuesta AI externa (solo el autor)      |
| `finalize_opinion(id, verdict)`      | `write` | Finaliza con veredicto consensuado               |
| `get_opinion(id)`                    | `view`  | Lee el texto original                            |
| `get_ai_response(id)`                | `view`  | Lee la respuesta AI                              |
| `get_verdict(id)`                    | `view`  | Lee el veredicto final                           |
| `get_status(id)`                     | `view`  | Lee el estado (`pending`/`evaluated`/`finalized`)|
| `get_author(id)`                     | `view`  | Lee la dirección del autor                       |
| `get_total_submissions()`            | `view`  | Lee el total de opiniones registradas            |
| `get_full_entry(id)`                 | `view`  | Devuelve todos los datos como JSON string        |

---

## Despliegue

### Opción 1 — GenLayer Studio (recomendado para testnet)

1. Ve a [GenLayer Studio](https://studio.genlayer.com)
2. Crea un nuevo contrato y pega el contenido de `contract/engagechain.py`
3. Despliégalo y copia la dirección del contrato
4. Pega esa dirección en **Network Settings** del frontend

### Opción 2 — CLI local

```bash
# Instalar GenLayer CLI
pip install genlayer

# Desplegar contrato
genlayer deploy contract/engagechain.py

# Interactuar
genlayer call <contract_address> submit_opinion "Mi propuesta de ejemplo"
genlayer call <contract_address> evaluate_opinion 0
genlayer call <contract_address> get_full_entry 0
```

---

## Frontend

El frontend es una web estática que usa [GenLayerJS](https://docs.genlayer.com/tools/genlayerjs) para interactuar con el contrato.

### Cómo usarlo

1. Abre `frontend/index.html` en un navegador
2. Ve a **Network Settings** al final de la página
3. Configura:
   - **Contract Address**: dirección del contrato desplegado
   - **RPC Endpoint**: `http://localhost:4000/api` (local) o endpoint de testnet
   - **Private Key**: clave para testnet (nunca uses mainnet aquí)
   - **Account Address**: tu dirección
4. Click en **Save Config**
5. Usa el formulario de **Submit** para enviar una opinión

### Incluir GenLayerJS vía CDN

Agrega en `index.html` antes del cierre de `</body>`:

```html
<script src="https://unpkg.com/genlayer@latest/dist/genlayer.umd.js"></script>
```

Si no incluyes el CDN, el frontend usa llamadas RPC directas como fallback automático.

---

## Lógica de consenso

EngageChain está diseñado para la arquitectura de GenLayer:

- **Optimistic Democracy**: un validador líder propone el resultado de `evaluate_opinion`; otros validadores ejecutan el mismo prompt localmente y comparan
- **Equivalence Principle**: resultados semánticamente equivalentes son aceptados aunque no sean idénticos
- **Tolerancia a variación**: el análisis JSON puede variar en palabras exactas pero si el sentimiento, categoría y recomendación son equivalentes, el consenso pasa

---

## Casos de uso

- Gobernanza asistida por IA (propuestas de comunidad)
- Análisis de disputas verificable on-chain
- Validación de ideas con historial inmutable
- Registro de opiniones con veredicto consensuado
- Prototipo de decisiones humanas + AI en blockchain

---

## Tecnologías

| Capa        | Tecnología                   |
|-------------|------------------------------|
| Contrato    | Python + GenLayer SDK        |
| Red         | GenLayer (testnet)           |
| Consenso    | Optimistic Democracy         |
| AI          | LLM vía `gl.exec_prompt()`   |
| Frontend    | HTML + CSS + JavaScript      |
| SDK Web     | GenLayerJS                   |

---

*EngageChain — Turning subjective opinions into verifiable on-chain outcomes.*
