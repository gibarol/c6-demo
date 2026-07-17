# ⚠️ LEIA ANTES DE MEXER — Onde está o front e como faz deploy

## Esta é a LP de PRODUÇÃO
- **Site no ar:** https://credito.premiumclientes.com.br
- **Versão:** **Teu Crédito** (azul, "via C6 Bank") — NÃO é a versão "C6 Crédito Trabalhador" (verde).
- **Pasta (fonte da verdade):** `C:\dev\c6-frontend`  ← **ESTA PASTA, no disco local**
- **Repo git:** `github.com/gibarol/c6-demo`
- **Projeto Vercel:** `c6-demo` (org `gibarols-projects`), domínio custom `credito.premiumclientes.com.br`
- **Backend/API:** `VITE_API_URL=https://kommo-c6-api.onrender.com` (ver `.env.production`)

## ❌ NÃO confundir com a outra pasta
Existe `G:\Meu Drive\GL\API Bancos\C6\frontend` — é **OUTRO** projeto (repo `c6-consignado`),
a versão **antiga verde**, com `base: '/c6-consignado/'` (feito p/ GitHub Pages).
**NUNCA deployar essa pasta no c6-demo** — ela sobrescreve a Teu Crédito e quebra o site
(base errado → tela branca / marca errada).

## Como fazer deploy (correto)
O deploy é **manual via Vercel CLI**, desta pasta (`C:\dev\c6-frontend`). O build roda na
**nuvem do Vercel** (não precisa build local perfeito).

```bash
cd /c/dev/c6-frontend
vercel --prod --yes          # (já linkado ao projeto c6-demo via .vercel/)
```

Depois do deploy, **SEMPRE verificar que a página RENDERIZA** (não só carrega o título):
```bash
# título deve ser "Teu Crédito", assets em /assets/ (NÃO /c6-consignado/assets/):
curl -s https://credito.premiumclientes.com.br/ | grep -E "<title>|/assets/"
```
Abrir o site e confirmar o chat azul "Sou o assistente digital da Teu Crédito".

## Config que NÃO pode quebrar
- `vite.config.ts` → `base: '/'` (site é servido na raiz do domínio; `/c6-consignado/` quebra).
- `vercel.json` → rewrite SPA `/(.*) → /index.html` (ok, mas assets têm que existir em `/assets/`).
- `tsc -b` roda no build: **variável/parâmetro não usado quebra o deploy** (noUnusedLocals).

## Rastreamento (pixels)
- **Meta Pixel:** `fbqTrack('Lead')` no ChatWizard (consulta concluída).
- **TikTok Pixel:** `src/tiktok.ts` (ID público `D9DAP1RC77U1MDFHRQKG`, override por
  `VITE_TIKTOK_PIXEL_ID`). Eventos: `PageView` (load, em `main.tsx`), `SubmitForm`
  (consulta concluída, junto do `fbqTrack('Lead')`), `CompleteRegistration` ("Sim, quero!").
  O pixel é blindado (try/catch) — nunca pode derrubar a LP.
