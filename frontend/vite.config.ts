/// <reference types="vitest/config" />
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 根 404.html 属于英文构建;/zh/ 子树的深链经它重定向到中文入口,
// 原始路径由 sessionStorage 带回,由 demo 入口在渲染前还原。
const ZH_REDIRECT_SNIPPET =
  '<script>if(location.pathname.startsWith("/CourseHub/zh/")){' +
  'sessionStorage.setItem("coursehub.demo.path",location.pathname);' +
  'location.replace("/CourseHub/zh/");}</script>'

// 本地开发经 /api 代理到 CourseHub 后端;生产由 nginx 做同样的映射。
// 后端主机端口可用 frontend/.env.local 的 VITE_PROXY_TARGET 覆盖
// (对应后端 compose 的 COURSEHUB_HOST_PORT)。
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const demoZh = mode === 'demo-zh'
  const demo = mode === 'demo' || demoZh
  const outDir = demoZh ? 'dist-demo/zh' : demo ? 'dist-demo' : 'dist'
  return {
    plugins: [
      react(),
      tailwindcss(),
      // Demo Mode(vite --mode demo / demo-zh):同一 index.html,入口换成
      // src/demo/main.tsx,网络边界由实录回放接管(ADR-0003)。
      // 正常构建的模块图不含 demo 代码。中文构建同时改 <html lang>。
      demo && {
        name: 'coursehub-demo-entry',
        // order: 'pre' — 必须在 Vite 解析 HTML 入口之前替换 script src。
        transformIndexHtml: {
          order: 'pre' as const,
          handler: (html: string) => {
            const entry = html.replace('/src/main.tsx', '/src/demo/main.tsx')
            return demoZh ? entry.replace('lang="en"', 'lang="zh-CN"') : entry
          },
        },
      },
      // 中文 demo 构建:chrome 文案模块整体替换为 strings.zh.ts,
      // 生产代码与英文构建不受影响。
      demoZh &&
        ({
          name: 'coursehub-demo-zh-strings',
          enforce: 'pre',
          async resolveId(source, importer) {
            if (!source.endsWith('/strings') && source !== './strings') return null
            const resolved = await this.resolve(source, importer, { skipSelf: true })
            // Windows 下 Vite 的 id 用正斜杠,path.resolve 用反斜杠;比较前归一化。
            const posix = (p: string) => p.replace(/\\/g, '/')
            if (
              resolved &&
              posix(resolved.id) === posix(resolve(import.meta.dirname, 'src/lib/strings.ts'))
            ) {
              return posix(resolve(import.meta.dirname, 'src/lib/strings.zh.ts'))
            }
            return null
          },
        } satisfies Plugin),
      // GitHub Pages 对未知路径回 404.html。根 404 由英文构建产出:
      // 复制 index.html 承接 /dev 深链,并注入 /zh/ 子树的重定向脚本。
      demo &&
        !demoZh && {
          name: 'coursehub-demo-404',
          closeBundle: async () => {
            const html = await readFile('dist-demo/index.html', 'utf8')
            await writeFile(
              'dist-demo/404.html',
              html.replace('<head>', `<head>\n    ${ZH_REDIRECT_SNIPPET}`),
              'utf8',
            )
          },
        },
    ],
    // Pages project site 部署在 /CourseHub/ 之下;中文页在 /CourseHub/zh/。
    base: demoZh ? '/CourseHub/zh/' : demo ? '/CourseHub/' : '/',
    define: {
      'import.meta.env.VITE_DEMO_LOCALE': JSON.stringify(demoZh ? 'zh' : 'en'),
    },
    build: {
      outDir,
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
