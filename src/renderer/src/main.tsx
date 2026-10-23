import '@fontsource-variable/geist'
import '@fontsource-variable/jetbrains-mono'
import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ToastProvider } from './components/Toaster'
import { showScrollbarsWhileScrolling } from './lib/scrollbars'

showScrollbarsWhileScrolling(document, 800, document.documentElement)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>
)
