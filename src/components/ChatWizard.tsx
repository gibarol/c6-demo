import { useState, useEffect, useRef, useCallback } from 'react'
import ChatBubble, { type Message, BtAvatar } from './ChatBubble'
import TypingIndicator from './TypingIndicator'
import { checkAuthStatus, pollAuthStatus, generateLiveness, finalize, capture } from '../api'
import {
  validateCPF, formatCPF, formatPhone, formatDate,
  formatCurrency, uid, sleep, getUtmParams, fbqTrack,
} from '../utils'

type InputMode = 'cpf' | 'name' | 'birth' | 'phone' | 'none'

type Step =
  | 'waiting_name'
  | 'waiting_clt'              // qualificador: trabalha CLT há +3 meses?
  | 'dismissed'               // respondeu Não → fluxo encerrado educadamente
  | 'cpf'
  | 'checking'                 // processando, bloqueia input
  | 'waiting_phone_authorized' // já autorizado: só falta telefone p/ finalizar
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
// Não coletamos mais a data de nascimento — o liveness usa esta data genérica fixa.
const BIRTH_DEFAULT   = '1990-10-10'

const D = { fast: 1200, normal: 2400, slow: 3000 }

export default function ChatWizard() {
  const [messages, setMessages]   = useState<Message[]>([])
  const [step, setStep]           = useState<Step>('waiting_name')
  const [isTyping, setIsTyping]   = useState(false)
  const [inputMode, setInputMode] = useState<InputMode>('none')
  const [input, setInput]         = useState('')

  const [cpf,          setCpf]          = useState('')
  const [nome,         setNome]         = useState('')
  const [phone,        setPhone]        = useState('')
  const [livenessLink, setLivenessLink] = useState('')

  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLInputElement>(null)

  // refs para uso dentro de effects/intervals sem stale closure
  const cpfRef      = useRef(''); useEffect(() => { cpfRef.current      = cpf      }, [cpf])
  const nomeRef     = useRef(''); useEffect(() => { nomeRef.current     = nome     }, [nome])
  const phoneRef    = useRef(''); useEffect(() => { phoneRef.current    = phone    }, [phone])
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
    cpfV: string, nomeV: string, phoneV: string,
  ) => {
    setStep('checking')
    let res
    try {
      res = await finalize({
        cpf: cpfV, nome: nomeV, telefone: phoneV,
        data_nascimento: BIRTH_DEFAULT,
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
      await addBot('Consulta concluída... 👀', D.normal)
      await addBot(`🎉 *${first}*, tenho uma ótima notícia!`, D.normal)
      await sleep(400)
      await addBot(
        `💰 Você tem *${formatCurrency(t.valor_cliente)}* pré-aprovados\nem *${t.quantidade_parcelas}x* de *${formatCurrency(t.valor_parcela)}*.`,
        D.slow,
      )
      await addBot('Um *especialista* finaliza tudo com você agora. Bora? 😊', D.normal)
      setStep('waiting_interest')
    } else {
      await addBot(`Consulta concluída, *${first}*. 🙏`, D.normal)
      await addBot('No momento o C6 não liberou oferta pro seu perfil — mas isso muda a cada *virada de folha*.', D.slow)
      await addBot('Guardei seu cadastro e te aviso assim que surgir algo. Combinado? 😊', D.normal)
      setStep('no_offer_done')
    }
  }, [addBot])

  // ── Polling de autorização ─────────────────────────────────────────────────
  useEffect(() => {
    if (step !== 'polling_auth') return
    let cancelled = false

    const poll = async () => {
      if (cancelled) return
      try {
        const result = await pollAuthStatus(cpfRef.current)
        if (cancelled) return
        if (result.status === 'AUTORIZADO') {
          cancelled = true
          await addBot('✅ *Autorização confirmada!* Consultando sua oferta...', D.normal)
          await finalizeAndShow(cpfRef.current, nomeRef.current, phoneRef.current)
        } else if (result.status === 'NAO_AUTORIZADO' && result.observacao !== 'sem_registro') {
          // Terminal: biometria concluída, mas sem vínculo/margem CLT no autorizador.
          // Trata como "sem oferta": finalize consulta a oferta, confirma que não há e
          // cria o lead no Kommo p/ remarketing (mensagem educada, sem WhatsApp).
          cancelled = true
          await finalizeAndShow(cpfRef.current, nomeRef.current, phoneRef.current)
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

  // ── Qualificador CLT (Sim/Não) ──────────────────────────────────────────────
  const handleCltReply = useCallback(async (choice: 'sim' | 'nao') => {
    setStep('checking')
    if (choice === 'sim') {
      addUser('Sim, trabalho registrado(a) há mais de 3 meses.')
      await addBot('Perfeito, você tem o perfil! 🙌', D.fast)
      await addBot('Agora seu *CPF* — é com ele que faço a consulta oficial no C6. Seus dados são protegidos (*LGPD*). 🔐', D.normal)
      setStep('cpf')
      setInputMode('cpf')
    } else {
      addUser('Não.')
      await addBot('Entendo, e obrigado pela sinceridade. 🙏', D.fast)
      await addBot('O *Crédito do Trabalhador* pede *carteira assinada há mais de 3 meses* — por isso ainda não dá pra seguir.', D.normal)
      await addBot('Quando completar esse tempo, volta aqui que a gente te ajuda! 😊', D.normal)
      setStep('dismissed')
    }
  }, [addBot])

  // ── Quick reply (oferta) ────────────────────────────────────────────────────
  const handleQuickReply = useCallback(async (choice: 'sim' | 'nao') => {
    setStep('checking')
    if (choice === 'sim') {
      addUser('Sim, quero! 😊')
      await addBot('Perfeito! 🙌 É só tocar no botão abaixo pra falar *agora* com um especialista e liberar seu crédito com toda a segurança. 👇', D.normal)
      setStep('authorized')
    } else {
      addUser('Agora não.')
      await addBot('Sem problema, sem pressão! 😊', D.fast)
      await addBot('Sua oferta fica *guardada*. Quando quiser seguir, é só me chamar. 💚', D.normal)
      setStep('not_interested')
    }
  }, [addBot])

  // ── Abertura ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      await addBot('Oi! 👋 Sou o assistente digital da *Teu Crédito*.', D.fast)
      await addBot('Em 1 minuto eu verifico, *grátis e sem compromisso*, quanto de crédito você tem disponível. 💚', D.normal)
      await addBot('Como posso te chamar?', D.fast)
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
      await addBot('Somos *correspondente autorizado do C6 Bank* — consulta oficial e segura. 🔒', D.normal)
      // Qualificador: só segue quem tem carteira assinada há +3 meses.
      await addBot('Pra começar: você tem *carteira assinada (CLT) há mais de 3 meses*? 💼', D.normal)
      setStep('waiting_clt')
      setInputMode('none')
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
      await addBot('Ótimo! Consultando direto no C6... 🔎', D.normal)

      let authStatus = 'NAO_AUTORIZADO'
      try {
        const r = await checkAuthStatus(cpfDigits)
        authStatus = r.status
      } catch { authStatus = 'NAO_AUTORIZADO' }

      if (authStatus === 'AUTORIZADO') {
        // Já autorizado → não precisa de liveness nem de data de nascimento.
        await addBot('Sua identidade *já está confirmada*! ✅', D.normal)
        await addBot('Só o seu *celular com DDD* pra liberar o resultado. 📱', D.normal)
        setStep('waiting_phone_authorized')
        setInputMode('phone')
      } else {
        // Não autorizado → precisa do liveness. Não pedimos mais nascimento
        // (usamos BIRTH_DEFAULT); só o telefone.
        await addBot('Localizei você! 🎯', D.fast)
        await addBot('Pra liberar sua oferta, o C6 pede uma *confirmação rápida e segura* (1 minuto). 🔒', D.normal)
        await addBot('Me passa seu *celular com DDD*? 📱', D.normal)
        setStep('waiting_phone_liveness')
        setInputMode('phone')
      }
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
      await addBot('Show! Gerando seu *link seguro*... 🔐', D.normal)

      try {
        const result = await generateLiveness({
          cpf: cpfRef.current,
          nome: nomeRef.current,
          data_nascimento: BIRTH_DEFAULT,
          telefone: digits,
          lead_id: capturedLeadIdRef.current,
        })
        setLivenessLink(result.link)
        await addBot(`Último passo, *${nomeRef.current.split(' ')[0]}*! 🎯`, D.normal)
        await addBot('Pra ver sua *oferta completa*, o C6 precisa da sua *autorização* — uma selfie rápida no app oficial. Eu detecto na hora que você concluir. 🔒', D.slow)
        await addBot('É só tocar no botão abaixo 👇', D.normal)
        setStep('polling_auth')
      } catch {
        await addBot('Tive um problema ao gerar o link. Vamos tentar de novo?', D.fast)
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
      await finalizeAndShow(cpfRef.current, nomeRef.current, digits)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const waMessage = encodeURIComponent(
    `Olá! Sou ${nome} e acabei de verificar minha oferta pela Teu Crédito. Gostaria de continuar o atendimento.`
  )
  const showWhatsApp = step === 'authorized' || step === 'not_interested' || step === 'not_authorized'

  return (
    <div className="flex flex-col h-full wa-bg">

      {/* Header */}
      <div className="bg-teu text-white px-4 py-3 flex items-center gap-3 shadow-lg flex-shrink-0">
        <div className="w-11 h-11 rounded-full flex-shrink-0 overflow-hidden">
          <BtAvatar size={44} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-[16px] leading-tight tracking-tight">Teu Crédito</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
            <p className="text-[11px] text-gray-400">Crédito Rápido e Fácil</p>
          </div>
        </div>
        <div className="flex-shrink-0 bg-white/15 rounded-md px-2 py-1">
          <span className="text-[9px] text-white/60">via </span>
          <span className="text-[11px] font-bold text-white">C6 Bank</span>
        </div>
      </div>

      {/* Mensagens */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-2.5">
        {messages.map(msg => (
          <ChatBubble key={msg.id} message={msg} />
        ))}

        {isTyping && <TypingIndicator />}

        {/* Botão de autorização em DESTAQUE + indicador de espera */}
        {step === 'polling_auth' && (
          <div className="space-y-3 msg-enter">
            {livenessLink && (
              <div className="flex flex-col items-center gap-1.5 pt-1">
                <a
                  href={livenessLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full max-w-[320px] bg-teu text-white font-bold px-6 py-5 rounded-2xl shadow-xl text-[17px] text-center hover:bg-teu-dark active:scale-95 transition-all animate-pulse"
                >
                  🔒 Autorizar minha consulta
                </a>
                <span className="text-[11px] text-gray-500">Toque para abrir a autorização segura do C6</span>
              </div>
            )}
            <div className="flex items-end gap-2 max-w-[88%]">
              <div className="w-9 h-9 rounded-full flex-shrink-0 mb-0.5 overflow-hidden shadow-sm">
                <BtAvatar size={36} />
              </div>
              <div className="bg-white rounded-2xl rounded-tl-none px-4 py-2.5 shadow-sm">
                <p className="text-[13px] text-gray-500 animate-pulse">
                  ⏳ Aguardando você autorizar no link...
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Qualificador CLT (Sim/Não) */}
        {step === 'waiting_clt' && (
          <div className="flex gap-2 ml-11 msg-enter pt-1 flex-wrap">
            <button
              onClick={() => handleCltReply('sim')}
              className="bg-teu text-white text-[14px] font-semibold px-5 py-2.5 rounded-full shadow hover:bg-teu-dark active:scale-95 transition-all"
            >
              ✅ Sim
            </button>
            <button
              onClick={() => handleCltReply('nao')}
              className="border border-gray-300 text-gray-500 text-[14px] px-5 py-2.5 rounded-full hover:bg-gray-100 active:scale-95 transition-all"
            >
              Não
            </button>
          </div>
        )}

        {/* Quick replies */}
        {step === 'waiting_interest' && (
          <div className="flex gap-2 ml-11 msg-enter pt-1 flex-wrap">
            <button
              onClick={() => handleQuickReply('sim')}
              className="bg-teu text-white text-[14px] font-semibold px-5 py-2.5 rounded-full shadow hover:bg-teu-dark active:scale-95 transition-all"
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
              className="w-11 h-11 rounded-full bg-teu text-white flex items-center justify-center hover:bg-teu-dark active:scale-95 transition-all flex-shrink-0"
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            </button>
          </form>
          <p className="text-[11px] text-gray-400 text-center px-4 py-1.5 bg-[#F0F0F0]">
            Teu Crédito · Correspondente Bancário Autorizado C6 · LGPD
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
