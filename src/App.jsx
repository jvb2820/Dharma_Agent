import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import MainLayout from './layouts/MainLayout'
import Chat from './pages/Chat'
import Settings from './pages/Settings'
import { AgentProvider } from './context/AgentContext'
import { ChatProvider } from './context/ChatContext'
import './styles/app.css'

function App() {
  return (
    <AgentProvider>
      <ChatProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<MainLayout />}>
              <Route index element={<Navigate to="/chat" replace />} />
              <Route path="/chat" element={<Chat />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/chat" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ChatProvider>
    </AgentProvider>
  );
}

export default App; s
