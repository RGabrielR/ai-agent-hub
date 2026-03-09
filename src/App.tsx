import { BrowserRouter, Routes, Route } from 'react-router-dom'
import AgentsShowcase from '@/pages/agents-showcase'
import ChatRagAgent from '@/agents/chatrag'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AgentsShowcase />} />
        <Route path="/agents/chatrag" element={<ChatRagAgent />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
