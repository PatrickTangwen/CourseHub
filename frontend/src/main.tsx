import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { DevPanel } from './dev/DevPanel.tsx'
import { initTheme } from './lib/theme.ts'

initTheme()

// /dev 是隐藏的开发者面板路由(导航不提供入口);其余路径都是聊天主界面。
const Root = window.location.pathname === '/dev' ? DevPanel : App

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
