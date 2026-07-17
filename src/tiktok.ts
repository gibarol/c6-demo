/**
 * Pixel do TikTok — carregado só se houver Pixel ID.
 *
 * O ID é público (fica no HTML do site), então o default fica no código e
 * funciona no deploy sem env. VITE_TIKTOK_PIXEL_ID sobrescreve se um dia trocar.
 * Sem ID → no-op (não injeta nada). Tudo blindado: o pixel NUNCA pode quebrar a LP.
 *
 * Eventos no funil:
 *   PageView             → abriu a LP
 *   SubmitForm           → digitou CPF válido e consultou (evento de otimização)
 *   CompleteRegistration → confirmou "quero" (conversão real)
 */
const PIXEL_ID =
  (import.meta.env.VITE_TIKTOK_PIXEL_ID as string | undefined) || 'D9DAP1RC77U1MDFHRQKG'

declare global {
  interface Window {
    ttq?: {
      page: () => void
      track: (event: string, params?: Record<string, unknown>) => void
      load: (id: string) => void
      instance?: unknown
    }
    TiktokAnalyticsObject?: string
  }
}

let started = false

/** Injeta o snippet base do TikTok e registra o PageView. Idempotente e blindado. */
export function initPixel(): void {
  if (started || !PIXEL_ID || typeof window === 'undefined') return
  started = true
  try {
    // Snippet oficial do TikTok (bootstrap da fila ttq), adaptado para TS.
    ;(function (w: Window, d: Document, t: string) {
      w.TiktokAnalyticsObject = t
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ttq: any = ((w as any)[t] = (w as any)[t] || [])
      ttq.methods = [
        'page', 'track', 'identify', 'instances', 'debug', 'on', 'off',
        'once', 'ready', 'alias', 'group', 'enableCookie', 'disableCookie',
      ]
      ttq.setAndDefer = function (obj: any, method: string) {
        obj[method] = function () {
          // eslint-disable-next-line prefer-rest-params
          obj.push([method].concat(Array.prototype.slice.call(arguments, 0)))
        }
      }
      for (let i = 0; i < ttq.methods.length; i++) ttq.setAndDefer(ttq, ttq.methods[i])
      ttq.instance = function (id: string) {
        const inst = ttq._i[id] || []
        for (let n = 0; n < ttq.methods.length; n++) ttq.setAndDefer(inst, ttq.methods[n])
        return inst
      }
      ttq.load = function (id: string, opts?: unknown) {
        const url = 'https://analytics.tiktok.com/i18n/pixel/events.js'
        ttq._i = ttq._i || {}
        ttq._i[id] = []
        ttq._i[id]._u = url
        ttq._t = ttq._t || {}
        ttq._t[id] = +new Date()
        ttq._o = ttq._o || {}
        ttq._o[id] = opts || {}
        const script = d.createElement('script')
        script.type = 'text/javascript'
        script.async = true
        script.src = url + '?sdkid=' + id + '&lib=' + t
        const first = d.getElementsByTagName('script')[0]
        if (first && first.parentNode) first.parentNode.insertBefore(script, first)
        else d.head.appendChild(script)
      }
      ttq.load(PIXEL_ID)
      ttq.page()
    })(window, document, 'ttq')
  } catch {
    /* pixel nunca pode derrubar a LP */
  }
}

/** Dispara um evento de conversão (no-op se o pixel não estiver ativo). */
export function track(event: string, params?: Record<string, unknown>): void {
  if (!PIXEL_ID || typeof window === 'undefined' || !window.ttq) return
  try {
    window.ttq.track(event, params)
  } catch {
    /* idem */
  }
}
