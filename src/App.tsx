import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import ChatRagAgent from '@/agents/chatrag'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ChatRagAgent />} />
        <Route path="/agents/chatrag" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
