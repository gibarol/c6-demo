export function validateCPF(cpf: string): boolean {
  const d = cpf.replace(/\D/g, '')
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false
  for (let j = 0; j < 2; j++) {
    let sum = 0
    for (let i = 0; i < 9 + j; i++) sum += parseInt(d[i]) * (10 + j - i)
    let check = 11 - (sum % 11)
    if (check >= 10) check = 0
    if (check !== parseInt(d[9 + j])) return false
  }
  return true
}

export function formatCPF(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 11)
  return d
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4')
}

export function formatPhone(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 10) return d.replace(/(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3')
  return d.replace(/(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3')
}

export function formatDate(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 8)
  return d
    .replace(/(\d{2})(\d)/, '$1/$2')
    .replace(/(\d{2})\/(\d{2})(\d)/, '$1/$2/$3')
}

export function toISODate(ddmmyyyy: string): string {
  const [day, month, year] = ddmmyyyy.split('/')
  return `${year}-${month}-${day}`
}

export function formatCurrency(val: string | number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  }).format(Number(val))
}

export function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export function getUtmParams(): Record<string, string | undefined> {
  const p = new URLSearchParams(window.location.search)
  return {
    utm_source: p.get('utm_source') ?? undefined,
    utm_medium: p.get('utm_medium') ?? undefined,
    utm_campaign: p.get('utm_campaign') ?? undefined,
    utm_content: p.get('utm_content') ?? undefined,
    fbclid: p.get('fbclid') ?? undefined,
  }
}

/** Dispara um evento no Meta Pixel, se ele estiver carregado (index.html). */
export function fbqTrack(event: string, params?: Record<string, unknown>): void {
  const w = window as unknown as { fbq?: (...a: unknown[]) => void }
  if (typeof w.fbq === 'function') w.fbq('track', event, params)
}
