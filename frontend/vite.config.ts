/// <reference types="vitest/config" />
import { copyFile } from 'node:fs/promises'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 本地开发经 /api 代理到 CourseHub 后端;生产由 nginx 做同样的映射。
// 后端主机端口可用 frontend/.env.local 的 VITE_PROXY_TARGET 覆盖
// (对应后端 compose 的 COURSEHUB_HOST_PORT)。
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const demo = mode === 'demo'
  return {
    plugins: [
      react(),
      tailwindcss(),
      // Demo Mode(vite --mode demo):同一 index.html,入口换成 src/demo/main.tsx,
      // 网络边界由实录回放接管(ADR-0003)。正常构建的模块图不含 demo 代码。
      demo && {
        name: 'coursehub-demo-entry',
        // order: 'pre' — 必须在 Vite 解析 HTML 入口之前替换 script src。
        transformIndexHtml: {
          order: 'pre' as const,
          handler: (html: string) =>
            html.replace('/src/main.tsx', '/src/demo/main.tsx'),
        },
      },
      // GitHub Pages 对未知路径回 404.html;复制 index.html 使 /dev 深链走 SPA 回退。
      demo && {
        name: 'coursehub-demo-404',
        closeBundle: async () => {
          await copyFile('dist-demo/index.html', 'dist-demo/404.html')
        },
      },
    ],
    // Pages project site 部署在 /CourseHub/ 之下。
    base: demo ? '/CourseHub/' : '/',
    build: {
      outDir: demo ? 'dist-demo' : 'dist',
    },
    server: {
      // 默认 5173;PORT 被占用场景(多个开发实例并存)由环境变量指定。
      port: Number(env.PORT) || 5173,
      proxy: {
        '/api': {
          target: env.VITE_PROXY_TARGET || 'http://localhost:8000',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/setupTests.ts'],
      css: false,
    },
  }
})
