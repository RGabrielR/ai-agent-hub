import { useState, useEffect } from 'react'
import { ThemeProvider } from '@/components/theme-provider'
import { NavigationProvider } from '@/context/navigation-context'
import { ChatProvider } from '@/context/chat-context'
import { KnowledgeBaseProvider } from '@/context/knowledge-base-context'
import { Sidebar } from '@/components/sidebar'
import { MainContent } from '@/components/main-content'
import AgentLoader from '@/components/agent-loader'

export default function ChatRagAgent() {
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Simulate loading time for better UX
    const timer = setTimeout(() => {
      setLoading(false)
    }, 1000)

    return () => clearTimeout(timer)
  }, [])

  if (loading) {
    return <AgentLoader />
  }

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <NavigationProvider>
        <ChatProvider>
          <KnowledgeBaseProvider>
            <div className="flex h-screen bg-background relative">
              {/* Left Sidebar */}
              <Sidebar />

              {/* Main Content */}
              <MainContent />
            </div>
          </KnowledgeBaseProvider>
        </ChatProvider>
      </NavigationProvider>
    </ThemeProvider>
  )
}
