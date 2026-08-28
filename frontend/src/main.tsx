import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { installAuthInterceptor } from './services/http.ts'
import { NotificationProvider } from './components/notifications/NotificationProvider.tsx'
import { TemporaryAdminProvider } from './contexts/TemporaryAdminContext.tsx'

installAuthInterceptor()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <NotificationProvider>
      <TemporaryAdminProvider>
        <App />
      </TemporaryAdminProvider>
    </NotificationProvider>
  </StrictMode>,
)
