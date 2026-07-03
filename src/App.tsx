import ChatWizard from './components/ChatWizard'

export default function App() {
  return (
    <div className="h-full flex items-center justify-center bg-gradient-to-br from-[#0d1330] via-[#0f1e4d] to-[#16348C] overflow-x-hidden p-0 sm:p-4">
      {/* Mobile frame */}
      <div className="w-full max-w-md h-full sm:h-[720px] sm:rounded-3xl sm:shadow-2xl sm:ring-1 sm:ring-white/10 overflow-hidden flex flex-col">
        <ChatWizard />
      </div>
    </div>
  )
}
