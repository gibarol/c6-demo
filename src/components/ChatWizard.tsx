import { useState, useEffect, useRef, useCallback } from 'react'
import ChatBubble, { type Message, BtAvatar } from './ChatBubble'
import TypingIndicator from './TypingIndicator'
import { checkAuthStatus, pollAuthStatus, generateLiveness, finalize, capture } from '../api'
import {
  validateCPF, formatCPF, formatPhone, formatDate,
  toISODate, formatCurrency, uid, sleep, getUtmParams, fbqTrack,
} from '../utils'

type InputMode = 'cpf' | 'name' | 'birth' | 'phone' | 'none'

type Step =
  | 'waiting_name'
  | 'cpf'
  | 'checking'                 // processando, bloqueia input
  | 'waiting_phone_authorized' // já autorizado: só falta telefone p/ finalizar
  | 'waiting_birth'            // não autorizado: pede nascimento
  | 'waiting_phone_liveness'   // não autorizado: pede telefone antes do liveness
  | 'polling_auth'             // aguarda autorização (polling)
  | 'waiting_interest'         // oferta exibida, aguarda resposta
  | 'no_offer_done'
  | 'not_interested'
  | 'not_authorized'
  | 'authorized'

const WHATSAPP_NUMBER = import.meta.env.VITE_WHATSAPP_NUMBER ?? '5511999999999'
const POLL_INTERVAL   = 15_000
const POLL_TIMEOUT_MS  = 20 * 60 * 1000

const D = { fast: 1200, normal: 2400, slow: 3000 }

export default function ChatWizard() {
  const [messages, setMessages]   = useState<Message[]>([])
  const [step, setStep]           = useState<Step>('waiting_name')
  const [isTyping, setIsTyping]   = useState(false)
  const [inputMode, setInputMode] = useState<InputMode>('none')
  const [input, setInput]         = useState('')
  const [pollCount, setPollCount] = useState(0)

  const [cpf,      setCpf]      = useState('')
  const [nome,     setNome]     = useState('')
  const [phone,    setPhone]    = useState('')
  const [birthISO, setBirthISO] = useState('')

  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLInputElement>(null)

  // refs para uso dentro de effects/intervals sem stale closure
  const cpfRef      = useRef(''); useEffect(() => { cpfRef.current      = cpf      }, [cpf])
  const nomeRef     = useRef(''); useEffect(() => { nomeRef.current     = nome     }, [nome])
  const phoneRef    = useRef(''); useEffect(() => { phoneRef.current    = phone    }, [phone])
  const birthISORef = useRef(''); useEffect(() => { birthISORef.current = birthISO }, [birthISO])
  // lead criado na captura-primeiro (CARRINHO ABANDONADO); o finalize move esse mesmo lead
  const capturedLeadIdRef = useRef<string | null>(null)

  // Captura-primeiro: cria o lead no carrinho assim que temos nome+CPF+telefone.
  const captureNow = useCallback(async (phoneDigits: string) => {
    try {
      const r = await capture({
        cpf: cpfRef.current, nome: nomeRef.current, telefone: phoneDigits, ...getUtmParams(),
      })
      if (r.lead_id) capturedLeadIdRef.current = String(r.lead_id)
    } catch { /* best-effort: se falhar, o finalize cria o lead no desfecho */ }
  }, [])

  const addBot = useCallback(async (text: string, delay = D.normal) => {
    setIsTyping(true)
    await sleep(delay)
    setIsTyping(false)
    setMessages(p => [...p, { id: uid(), from: 'bot', text }])
  }, [])

  const addUser = (text: string) =>
    setMessages(p => [...p, { id: uid(), from: 'user', text }])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isTyping])

  useEffect(() => {
    if (inputMode !== 'none') setTimeout(() => inputRef.current?.focus(), 100)
  }, [inputMode])

  // ── Finalização: checa oferta + cria lead no Kommo, exibe resultado ─────────
  const finalizeAndShow = useCallback(async (
    cpfV: string, nomeV: string, phoneV: string, birthISOV: string,
  ) => {
    setStep('checking')
    let res
    try {
      res = await finalize({
        cpf: cpfV, nome: nomeV, telefone: phoneV,
        data_nascimento: birthISOV || undefined,
        lead_id: capturedLeadIdRef.current,
        ...getUtmParams(),
      })
    } catch {
      await addBot('Tivemos uma instabilidade aqui. Tenta de novo em instantes? 🙏', D.fast)
      setStep('cpf'); setInputMode('cpf')
      return
    }

    fbqTrack('Lead')  // conversão pro Meta Pixel
    const first = nomeV.split(' ')[0]

    if (res.tem_oferta && res.oferta) {
      const t = res.oferta
      await addBot('Olha só... 👀', D.normal)
      await addBot(`🎉 *${first}, você tem uma oferta disponível!*`, D.normal)
      await sleep(400)
      await addBot(
        `Você pode receber até\n*${formatCurrency(t.valor_cliente)}*\nem *${t.quantidade_parcelas}x* de *${formatCurrency(t.valor_parcela)}*`,
        D.slow,
      )
      await addBot('Quer falar com um especialista agora e garantir? 😊', D.normal)
      setStep('waiting_interest')
    } else {
      await addBot('Consultei aqui...', D.normal)
      await addBot(
        `${first}, no momento não localizei uma oferta disponível pro seu perfil.`,
        D.slow,
      )
      await addBot(
        'Mas já guardei seus dados e te aviso assim que surgir uma condição pra você. 😊',
        D.slow,
      )
      setStep('no_offer_done')
    }
  }, [addBot])

  // ── Polling de autorização ─────────────────────────────────────────────────
  useEffect(() => {
    if (step !== 'polling_auth') return
    let cancelled = false

    const poll = async () => {
      if (cancelled) return
      setPollCount(c => c + 1)
      try {
        const result = await pollAuthStatus(cpfRef.current)
        if (cancelled) return
        if (result.status === 'AUTORIZADO') {
          cancelled = true
          await addBot('✅ *Autorização confirmada!* Consultando sua oferta...', D.normal)
          await finalizeAndShow(cpfRef.current, nomeRef.current, phoneRef.current, birthISORef.current)
        } else if (result.status === 'NAO_AUTORIZADO' && result.observacao !== 'sem_registro') {
          // Terminal: biometria concluída, mas sem vínculo/margem CLT no autorizador.
          // Trata como "sem oferta": finalize consulta a oferta, confirma que não há e
          // cria o lead no Kommo p/ remarketing (mensagem educada, sem WhatsApp).
          cancelled = true
          await finalizeAndShow(cpfRef.current, nomeRef.current, phoneRef.current, birthISORef.current)
        }
      } catch { /* silencioso — tenta no próximo ciclo */ }
    }

    poll()  // primeira verificação imediata
    const timer = setInterval(poll, POLL_INTERVAL)
    const timeout = setTimeout(async () => {
      if (cancelled) return
      cancelled = true
      clearInterval(timer)
      await addBot('O link de autorização expirou. Se quiser tentar de novo, é só informar o CPF. 🙏', D.normal)
      setStep('cpf'); setInputMode('cpf')
    }, POLL_TIMEOUT_MS)

    return () => { cancelled = true; clearInterval(timer); clearTimeout(timeout) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  // ── Quick reply (oferta) ────────────────────────────────────────────────────
  const handleQuickReply = useCallback(async (choice: 'sim' | 'nao') => {
    setStep('checking')
    if (choice === 'sim') {
      addUser('Sim, quero saber mais! 😊')
      await addBot('Ótimo! Fale com nossa equipe no WhatsApp para finalizar tudo. 👇', D.normal)
      setStep('authorized')
    } else {
      addUser('Agora não.')
      await addBot('Tudo bem, sem pressão. 😊', D.fast)
      await addBot('Se mudar de ideia, estarei por aqui!', D.normal)
      setStep('not_interested')
    }
  }, [addBot])

  // ── Abertura ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      await addBot('Olá! Seja bem-vindo à *Bt+Credi*. 👋', D.fast)
      await addBot('Antes de começar, como posso te chamar?', D.fast)
      setInputMode('name')
    }
    init()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value
    if      (inputMode === 'cpf')   setInput(formatCPF(raw))
    else if (inputMode === 'phone') setInput(formatPhone(raw))
    else if (inputMode === 'birth') setInput(formatDate(raw))
    else setInput(raw)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const value = input.trim()
    if (!value || inputMode === 'none') return
    setInput('')

    // ── Nome ──────────────────────────────────────────────────────────────────
    if (step === 'waiting_name') {
      addUser(value)
      const first = value.split(' ')[0]
      setNome(value)
      setInputMode('none')
      await addBot(`Prazer, *${first}*! 😊`, D.fast)
      await addBot('Somos correspondente bancário *autorizado* do C6 Bank.', D.normal)
      await addBot('Aqui você consulta o *Crédito Trabalhador* — desconto em folha, taxas competitivas, sem burocracia. 💳', D.slow)
      await addBot(`Pode me informar o seu CPF, ${first}?`, D.normal)
      setStep('cpf')
      setInputMode('cpf')
    }

    // ── CPF → checa autorização imediatamente ──────────────────────────────────
    else if (step === 'cpf') {
      if (!validateCPF(value)) {
        await addBot('Hmm, esse CPF não parece válido. Consegue conferir? 🙏', D.fast)
        return
      }
      addUser(value)
      const cpfDigits = value.replace(/\D/g, '')
      setCpf(cpfDigits)
      setInputMode('none')
      setStep('checking')
      await addBot('Deixa eu verificar... 🔍', D.fast)

      let authStatus = 'NAO_AUTORIZADO'
      try {
        const r = await checkAuthStatus(cpfDigits)
        authStatus = r.status
      } catch { authStatus = 'NAO_AUTORIZADO' }

      if (authStatus === 'AUTORIZADO') {
        // Já autorizado → não precisa de liveness nem de data de nascimento.
        await addBot('Perfeito, sua identidade já está confirmada! ✅', D.normal)
        await addBot('Só preciso do seu *celular com DDD* pra finalizar.', D.normal)
        setStep('waiting_phone_authorized')
        setInputMode('phone')
      } else {
        // Não autorizado → precisa do liveness (coleta nascimento + telefone).
        await addBot(
          'Para consultar sua oferta no C6 Bank, preciso confirmar sua identidade. É rápido, menos de 1 minuto. 🔒',
          D.slow,
        )
        await addBot('Qual é a sua *data de nascimento*? (DD/MM/AAAA)', D.normal)
        setStep('waiting_birth')
        setInputMode('birth')
      }
    }

    // ── Nascimento (caminho não autorizado) ────────────────────────────────────
    else if (step === 'waiting_birth') {
      if (!/^\d{2}\/\d{2}\/\d{4}$/.test(value)) {
        await addBot('Use o formato DD/MM/AAAA, por favor.', D.fast)
        return
      }
      addUser(value)
      setBirthISO(toISODate(value))
      setInputMode('none')
      await addBot('Ótimo! E qual é o seu *celular com DDD*?', D.fast)
      setStep('waiting_phone_liveness')
      setInputMode('phone')
    }

    // ── Telefone → gera liveness (caminho não autorizado) ──────────────────────
    else if (step === 'waiting_phone_liveness') {
      const digits = value.replace(/\D/g, '')
      if (digits.length < 10) {
        await addBot('Número inválido. Informe com DDD, por favor. 😊', D.fast)
        return
      }
      addUser(value)
      setPhone(digits)
      setStep('checking')
      setInputMode('none')
      // Captura-primeiro: cria o lead no carrinho ANTES de gerar o link.
      await captureNow(digits)
      await addBot('Gerando seu link de autorização...', D.normal)

      try {
        const result = await generateLiveness({
          cpf: cpfRef.current,
          nome: nomeRef.current,
          data_nascimento: birthISORef.current,
          telefone: digits,
          lead_id: capturedLeadIdRef.current,
        })
        await addBot(
          `Acesse o link abaixo e siga o processo de autorização:\n\n👉 ${result.link}\n\nÉ rápido, menos de 1 minuto! ✅`,
          D.normal,
        )
        await addBot('Vou verificar automaticamente. Pode ir lá e já volte! ⏳', D.fast)
        setPollCount(0)
        setStep('polling_auth')
      } catch {
        await addBot('Erro ao gerar o link. Tenta de novo?', D.fast)
        setStep('waiting_phone_liveness')
        setInputMode('phone')
      }
    }

    // ── Telefone (caminho já autorizado) → finaliza direto ─────────────────────
    else if (step === 'waiting_phone_authorized') {
      const digits = value.replace(/\D/g, '')
      if (digits.length < 10) {
        await addBot('Número inválido. Informe com DDD, por favor. 😊', D.fast)
        return
      }
      addUser(value)
      setPhone(digits)
      setInputMode('none')
      // Captura-primeiro: garante o lead no carrinho antes de finalizar (que o moverá).
      await captureNow(digits)
      await finalizeAndShow(cpfRef.current, nomeRef.current, digits, '')
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const waMessage = encodeURIComponent(
    `Olá! Sou ${nome} e acabei de verificar minha oferta pela Bt+Credi. Gostaria de continuar o atendimento.`
  )
  const showWhatsApp = step === 'authorized' || step === 'not_interested' || step === 'not_authorized'

  return (
    <div className="flex flex-col h-full wa-bg">

      {/* Header */}
      <div className="bg-black text-white px-4 py-3 flex items-center gap-3 shadow-lg flex-shrink-0">
        <div className="w-11 h-11 rounded-full flex-shrink-0 overflow-hidden">
          <BtAvatar size={44} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-[16px] leading-tight tracking-tight">Bt+Credi</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
            <p className="text-[11px] text-gray-400">Crédito Rápido e Fácil</p>
          </div>
        </div>
        <div className="flex-shrink-0 bg-gray-800 rounded-md px-2 py-1">
          <span className="text-[9px] text-gray-500">via </span>
          <span className="text-[11px] font-bold text-white">C6 Bank</span>
        </div>
      </div>

      {/* Mensagens */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-2.5">
        {messages.map(msg => (
          <ChatBubble key={msg.id} message={msg} />
        ))}

        {isTyping && <TypingIndicator />}

        {/* Indicador de polling + verificação manual */}
        {step === 'polling_auth' && (
          <div className="flex items-end gap-2 max-w-[88%] msg-enter">
            <div className="w-9 h-9 rounded-full flex-shrink-0 mb-0.5 overflow-hidden shadow-sm">
              <BtAvatar size={36} />
            </div>
            <div className="bg-white rounded-2xl rounded-tl-none px-4 py-2.5 shadow-sm space-y-2">
              <p className="text-[13px] text-gray-500 animate-pulse">
                ⏳ Verificando autorização{pollCount > 0 ? ` · ${pollCount}ª verificação` : ''}...
              </p>
              <p className="text-[11px] text-gray-400">Já autorizou? Clique para verificar agora:</p>
              <button
                onClick={async () => {
                  setStep('checking')
                  try {
                    const r = await pollAuthStatus(cpfRef.current)
                    if (r.status === 'AUTORIZADO') {
                      await addBot('✅ *Autorização confirmada!* Consultando sua oferta...', D.normal)
                      await finalizeAndShow(cpfRef.current, nomeRef.current, phoneRef.current, birthISORef.current)
                    } else if (r.status === 'NAO_AUTORIZADO' && r.observacao !== 'sem_registro') {
                      await finalizeAndShow(cpfRef.current, nomeRef.current, phoneRef.current, birthISORef.current)
                    } else {
                      await addBot('Ainda aguardando sua autorização... pode levar alguns segundos. ⏳', D.fast)
                      setStep('polling_auth')
                    }
                  } catch {
                    await addBot('Não consegui verificar agora. Seguimos tentando...', D.fast)
                    setStep('polling_auth')
                  }
                }}
                className="w-full bg-black text-white text-[12px] font-semibold px-3 py-1.5 rounded-full hover:bg-gray-800 active:scale-95 transition-all"
              >
                🔄 Verificar agora
              </button>
            </div>
          </div>
        )}

        {/* Quick replies */}
        {step === 'waiting_interest' && (
          <div className="flex gap-2 ml-11 msg-enter pt-1 flex-wrap">
            <button
              onClick={() => handleQuickReply('sim')}
              className="bg-black text-white text-[14px] font-semibold px-5 py-2.5 rounded-full shadow hover:bg-gray-800 active:scale-95 transition-all"
            >
              ✅ Sim, quero!
            </button>
            <button
              onClick={() => handleQuickReply('nao')}
              className="border border-gray-300 text-gray-500 text-[14px] px-5 py-2.5 rounded-full hover:bg-gray-100 active:scale-95 transition-all"
            >
              Agora não
            </button>
          </div>
        )}

        {/* WhatsApp CTA */}
        {showWhatsApp && (
          <div className="flex justify-center pt-3 pb-1 msg-enter">
            <a
              href={`https://wa.me/${WHATSAPP_NUMBER}?text=${waMessage}`}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-[#25D366] text-white font-bold px-8 py-4 rounded-full shadow-lg text-[15px] hover:opacity-90 active:scale-95 transition-all"
            >
              💬 Falar no WhatsApp
            </a>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      {inputMode !== 'none' && (
        <div className="flex-shrink-0">
          <form onSubmit={handleSubmit} className="bg-[#F0F0F0] px-3 py-2 flex gap-2 items-center">
            <input
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              placeholder={placeholder(inputMode)}
              inputMode={inputMode === 'name' ? 'text' : 'numeric'}
              className="flex-1 bg-white rounded-full px-5 py-3 text-[15px] outline-none shadow-sm placeholder-gray-400"
            />
            <button
              type="submit"
              className="w-11 h-11 rounded-full bg-black text-white flex items-center justify-center hover:bg-gray-800 active:scale-95 transition-all flex-shrink-0"
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            </button>
          </form>
          <p className="text-[11px] text-gray-400 text-center px-4 py-1.5 bg-[#F0F0F0]">
            Bt+Credi · Correspondente Bancário Autorizado C6 · LGPD
          </p>
        </div>
      )}
    </div>
  )
}

function placeholder(mode: InputMode): string {
  switch (mode) {
    case 'name':  return 'Seu nome...'
    case 'cpf':   return 'Digite seu CPF...'
    case 'birth': return 'DD/MM/AAAA'
    case 'phone': return '(11) 99999-9999'
    default:      return ''
  }
}
