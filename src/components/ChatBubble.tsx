export interface Message {
  id: string
  from: 'bot' | 'user'
  text: string
}

// Renderiza *negrito* como <strong>
function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*[^*]+\*)/)
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('*') && part.endsWith('*')
          ? <strong key={i}>{part.slice(1, -1)}</strong>
          : <span key={i}>{part}</span>
      )}
    </>
  )
}

export function BtAvatar({ size = 40 }: { size?: number }) {
  return (
    <svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" width={size} height={size}>
      <circle cx="20" cy="20" r="20" fill="#111" />
      {/* Cifrão */}
      <text
        x="20" y="18"
        textAnchor="middle"
        fontFamily="system-ui, sans-serif"
        fontWeight="900"
        fontSize="13"
        fill="white"
      >$</text>
      {/* Bt+ */}
      <text
        x="20" y="30"
        textAnchor="middle"
        fontFamily="system-ui, sans-serif"
        fontWeight="800"
        fontSize="9"
        letterSpacing="0.5"
        fill="#dddddd"
      >Bt+</text>
    </svg>
  )
}

export default function ChatBubble({ message }: { message: Message }) {
  if (message.from === 'bot') {
    return (
      <div className="flex items-end gap-2 max-w-[88%] msg-enter">
        <div className="w-9 h-9 rounded-full flex-shrink-0 mb-0.5 overflow-hidden shadow-sm">
          <BtAvatar size={36} />
        </div>
        <div className="bubble-bot bg-white rounded-2xl rounded-tl-none px-4 py-3 shadow-sm">
          <p className="text-[15px] leading-snug text-gray-800 whitespace-pre-line">
            <RichText text={message.text} />
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-end msg-enter">
      <div className="bubble-user bg-wa-sent rounded-2xl rounded-tr-none px-4 py-3 shadow-sm max-w-[80%]">
        <p className="text-[15px] leading-snug text-gray-800"><RichText text={message.text} /></p>
      </div>
    </div>
  )
}
