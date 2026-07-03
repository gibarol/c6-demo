import { BtAvatar } from './ChatBubble'

export default function TypingIndicator() {
  return (
    <div className="flex items-end gap-2 max-w-[88%] msg-enter">
      <div className="w-9 h-9 rounded-full flex-shrink-0 mb-0.5 overflow-hidden shadow-sm">
        <BtAvatar size={36} />
      </div>
      <div className="bubble-bot bg-white rounded-2xl rounded-tl-none px-5 py-4 shadow-sm flex items-center gap-1.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-2.5 h-2.5 rounded-full bg-gray-400 inline-block"
            style={{ animation: 'bounce-dot 0.8s ease-in-out infinite', animationDelay: `${i * 0.18}s` }}
          />
        ))}
      </div>
    </div>
  )
}
