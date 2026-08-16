/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 本地开发经 /api 代理到 CourseHub 后端;生产由 nginx 做同样的映射。
// 后端主机端口可用 frontend/.env.local 的 VITE_PROXY_TARGET 覆盖
// (对应后端 compose 的 COURSEHUB_HOST_PORT)。
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), tailwindcss()],
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
