/**
 * Chamadas ao ORQUESTRADOR (kommo-c6-api). O front nunca fala com o C6 nem com o
 * Kommo diretamente — tudo passa pelos endpoints /chat/*.
 *
 * Fluxo:
 *   /chat/start     → checa autorização do CPF
 *   /chat/liveness  → gera link de autorização (com data de nascimento real)
 *   /chat/status    → polling da autorização
 *   /chat/finalize  → checa oferta e cria o lead no Kommo (com/sem oferta)
 *
 * VITE_MOCK_MODE=true → mock embutido (para previews sem backend).
 */
import { sleep } from './utils'

const BASE      = import.meta.env.VITE_API_URL ?? ''
const MOCK_MODE = import.meta.env.VITE_MOCK_MODE === 'true'

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { detail?: string }).detail ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export interface AuthStatusResponse {
  status: 'AUTORIZADO' | 'AGUARDANDO_AUTORIZACAO' | 'NAO_AUTORIZADO' | string
  observacao?: string
}

export interface LivenessResponse {
  link: string
  data_expiracao?: string
}

export interface Trabalhador {
  valor_cliente: string
  quantidade_parcelas: string
  valor_parcela: string
  valor_taxa: string
  seguro?: { valor_seguro: string }
}

export interface FinalizeResponse {
  ok: boolean
  tem_oferta: boolean
  lead_id?: string | null
  oferta?: Trabalhador | null
}

export interface Utms {
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_content?: string
  fbclid?: string
}

// ── Mock embutido (VITE_MOCK_MODE=true) ──────────────────────────────────────
let _mockAuthorized = false

// ── Exports ───────────────────────────────────────────────────────────────────

/** Checa a autorização atual do CPF (primeira verificação, após coletar o CPF). */
export async function checkAuthStatus(cpf: string): Promise<AuthStatusResponse> {
  if (MOCK_MODE) {
    await sleep(700)
    return _mockAuthorized
      ? { status: 'AUTORIZADO' }
      : { status: 'NAO_AUTORIZADO', observacao: 'sem_registro' }
  }
  return post('/chat/start', { cpf })
}

/** Polling da autorização (enquanto o cliente assina o liveness). */
export async function pollAuthStatus(cpf: string): Promise<AuthStatusResponse> {
  if (MOCK_MODE) {
    await sleep(700)
    return _mockAuthorized
      ? { status: 'AUTORIZADO' }
      : { status: 'AGUARDANDO_AUTORIZACAO' }
  }
  return post('/chat/status', { cpf })
}

/** Gera o link de autorização (liveness) com a data de nascimento real. */
export async function generateLiveness(data: {
  cpf: string
  nome: string
  data_nascimento: string   // AAAA-MM-DD
  telefone?: string
  lead_id?: string | null
}): Promise<LivenessResponse> {
  if (MOCK_MODE) {
    _mockAuthorized = true   // após gerar o link, o mock simula autorização
    await sleep(1000)
    return { link: 'https://web.c6consig.com.br/demo-liveness', data_expiracao: '2026-12-31' }
  }
  return post('/chat/liveness', data)
}

/** Captura-primeiro: cria o lead em CARRINHO ABANDONADO com nome+CPF+telefone. */
export async function capture(data: {
  cpf: string
  nome: string
  telefone: string
} & Utms): Promise<{ ok: boolean; lead_id?: string | null }> {
  if (MOCK_MODE) { await sleep(300); return { ok: true, lead_id: 'mock-cart' } }
  return post('/chat/capture', data)
}

/** Cliente autorizado → checa oferta e move/cria o lead no Kommo (com/sem oferta). */
export async function finalize(data: {
  cpf: string
  nome: string
  telefone: string
  data_nascimento?: string
  lead_id?: string | null
  motivo_status?: string
  motivo_obs?: string
} & Utms): Promise<FinalizeResponse> {
  if (MOCK_MODE) {
    await sleep(1200)
    const semOferta = data.cpf.replace(/\D/g, '').endsWith('00')
    return {
      ok: true,
      tem_oferta: !semOferta,
      lead_id: 'mock-123',
      oferta: semOferta ? null : {
        valor_cliente: '3500.00',
        quantidade_parcelas: '36',
        valor_parcela: '123.45',
        valor_taxa: '2.10',
      },
    }
  }
  return post('/chat/finalize', data)
}
