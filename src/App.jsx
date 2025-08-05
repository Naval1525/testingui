import { useState } from 'react'
import './App.css'
import ChatWidget from './components/ChatWidget'
import FlowWidget from './components/FlowWidget'
import LoginLogoutButton from './components/LoginLogoutButton'
import { AuthProvider } from './context/AuthContext'

function App() {
  const [showChat, setShowChat] = useState(true)

  return (
    <AuthProvider>
      <div className="min-h-screen bg-gray-100 relative">
        {/* Header with toggle - only show when chat is active */}
        {showChat && (
          <header className="bg-white shadow-sm border-b z-10 relative">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex justify-between items-center h-16">
                <h1 className="text-xl font-semibold text-gray-900">Usuals.ai Editor</h1>
                <LoginLogoutButton />
              </div>
            </div>
          </header>
        )}

        {/* Main content area */}
        {!showChat ? (
          <div className="w-screen h-screen overflow-hidden">
            <FlowWidget />
          </div>
        ) : (
          <main className="p-4 h-[calc(100vh-4rem)]">
            <div className="h-full">
              {/* Placeholder for chat widget */}
            </div>
          </main>
        )}

        {/* Chat overlay */}
        {showChat && <ChatWidget />}

        {/* Small toggle button */}
        <button
          onClick={() => setShowChat((v) => !v)}
          className="fixed bottom-4 right-4 z-[10020] bg-blue-600 hover:bg-blue-500 text-white rounded-full w-12 h-12 flex items-center justify-center shadow-lg focus:outline-none"
          title={showChat ? 'Switch to Flow Editor' : 'Open Chat'}
        >
          {showChat ? '🛠️' : '💬'}
        </button>
      </div>
    </AuthProvider>
  )
}

export default App
