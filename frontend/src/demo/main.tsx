import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import App from '../App.tsx'
import { initTheme } from '../lib/theme.ts'
import { installDemoBackend } from './demoBackend.ts'

// Demo Mode 入口:先把网络边界接到实录回放上,再渲染与生产完全相同的应用。
installDemoBackend()
initTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
