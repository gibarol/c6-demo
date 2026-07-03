import ChatWizard from './components/ChatWizard'

export default function App() {
  return (
    <div className="h-full flex items-center justify-center bg-gray-900">
      {/* Mobile frame */}
      <div className="w-full max-w-sm h-full sm:h-[700px] sm:rounded-2xl sm:shadow-2xl overflow-hidden flex flex-col">
        <ChatWizard />
      </div>
    </div>
  )
}
