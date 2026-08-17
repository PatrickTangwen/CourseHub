import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import { initTheme } from '../lib/theme.ts'
import { installDemoBackend } from './demoBackend.ts'
import { seedDemoThreads } from './seed.ts'
import { DemoShell } from './DemoShell.tsx'

// GitHub Pages 深链恢复:根 404.html 对 /zh/ 子树只能重定向到子树入口,
// 原始路径经 sessionStorage 带回,渲染前还原(spa-github-pages 惯用法)。
const savedPath = sessionStorage.getItem('coursehub.demo.path')
if (savedPath) {
  sessionStorage.removeItem('coursehub.demo.path')
  window.history.replaceState(null, '', savedPath)
}

// Demo Mode 入口:先把网络边界接到实录回放上、播种首访会话,
// 再渲染与生产完全相同的应用。
installDemoBackend()
seedDemoThreads()
initTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DemoShell />
  </StrictMode>,
)
