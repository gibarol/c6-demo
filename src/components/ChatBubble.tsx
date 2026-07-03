export interface Message {
  id: string
  from: 'bot' | 'user'
  text: string
}

// Renderiza *negrito* como <strong> e URLs como links clicáveis (que quebram linha).
const TOKEN_RE = /(\*[^*]+\*|https?:\/\/[^\s]+)/g

function RichText({ text }: { text: string }) {
  const parts = text.split(TOKEN_RE)
  return (
    <>
      {parts.map((part, i) => {
        if (!part) return null
        if (part.length > 1 && part.startsWith('*') && part.endsWith('*')) {
          return <strong key={i}>{part.slice(1, -1)}</strong>
        }
        if (/^https?:\/\//.test(part)) {
          return (
            <a
              key={i}
              href={part}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 underline font-medium break-all"
            >
              {part}
            </a>
          )
        }
        return <span key={i}>{part}</span>
      })}
    </>
  )
}

export function BtAvatar({ size = 40 }: { size?: number }) {
  return (
    <svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" width={size} height={size}>
      <circle cx="20" cy="20" r="20" fill="#1B3FAE" />
      {/* teu */}
      <text
        x="20" y="20"
        textAnchor="middle"
        fontFamily="Arial, Helvetica, sans-serif"
        fontWeight="800"
        fontSize="13"
        fill="white"
      >teu</text>
      {/* crédito */}
      <text
        x="20" y="30"
        textAnchor="middle"
        fontFamily="Arial, Helvetica, sans-serif"
        fontWeight="600"
        fontSize="7"
        letterSpacing="0.3"
        fill="white"
      >crédito</text>
    </svg>
  )
}

export default function ChatBubble({ message }: { message: Message }) {
  if (message.from === 'bot') {
    return (
      <div className="flex items-end gap-2 max-w-[88%] min-w-0 msg-enter">
        <div className="w-9 h-9 rounded-full flex-shrink-0 mb-0.5 overflow-hidden shadow-sm">
          <BtAvatar size={36} />
        </div>
        <div className="bubble-bot bg-white rounded-2xl rounded-tl-none px-4 py-3 shadow-sm min-w-0">
          <p className="text-[15px] leading-snug text-gray-800 whitespace-pre-line break-words">
            <RichText text={message.text} />
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-end msg-enter">
      <div className="bubble-user bg-wa-sent rounded-2xl rounded-tr-none px-4 py-3 shadow-sm max-w-[80%] min-w-0">
        <p className="text-[15px] leading-snug text-gray-800 break-words"><RichText text={message.text} /></p>
      </div>
    </div>
  )
}
