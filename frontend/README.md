# CourseHub Frontend

ChatGPT 式的 UCSD 课程问答界面。React + Vite + TypeScript + Tailwind v4 + [assistant-ui](https://github.com/assistant-ui/assistant-ui)。

规格与协议:`docs/specs/coursehub-frontend.md`(SSE 事件协议见 §3.1);选型取舍:`docs/adr/0002-custom-sse-protocol-with-assistant-ui.md`。

## 功能

- 流式过程时间线:意图识别(三路融合分数)→ 多 Agent 路由(主/辅)→ 工具调用(course_lookup / knowledge_search,含耗时)→ 打字机答案;完成后收起为一行摘要,可展开
- 多会话侧边栏,localStorage 持久化;浏览器持久 UUID 作 `user_id`,服务端跨会话画像生效;同会话 `conv_id` 自动延续
- Advisor Referral 转介卡(`escalated=true`)、双语空态示例、深浅色主题(跟随系统 + 手动切换)、移动端抽屉布局
- SSE 建立失败自动回退非流式 `/chat`;错误气泡可重试;顶栏 `/health` 连接指示
- `/dev` 隐藏开发者面板:知识库导入/上传/统计、monitor 摘要、skills 热重载

## 开发

```bash
npm install
npm run dev        # http://localhost:5173,经 /api 代理到后端
npm test           # Vitest + RTL(整树渲染 + fixture SSE 流,无网络)
npm run typecheck
npm run build      # 静态产物 dist/
```

后端不在默认端口时,建 `frontend/.env.local`:

```env
VITE_PROXY_TARGET=http://localhost:8010
```

(与后端 compose 的 `COURSEHUB_HOST_PORT` 对应。)

## 部署

由 `EchoMind/docker-compose.yml` 统一编排:nginx 服务用本目录的多阶段 `Dockerfile` 构建(node 构建 → 静态产物进 nginx 镜像),配置在 `EchoMind/config/nginx/nginx.conf`(`/` 静态 + SPA 回退,`/api/` 代理,`/api/chat/stream` 关缓冲)。在 `EchoMind/` 下一条命令起全套:

```bash
docker compose up -d --build
```

## 结构

```text
src/
├── lib/
│   ├── chatAdapter.ts      # ChatModelAdapter:消费 SSE、打字机、/chat 回退
│   ├── sse.ts              # 增量 SSE 帧解析器
│   ├── stages.ts           # 阶段事件类型(协议 §3.1)
│   ├── stageDisplay.ts     # 领域术语映射(对齐 CONTEXT.md)+ 时间线构建
│   ├── threadListAdapter.tsx / threadStore.ts   # 多会话(localStorage)
│   ├── identity.ts         # 浏览器 UUID user_id
│   ├── theme.ts            # 主题(系统默认 + 手动)
│   └── strings.ts          # 全部界面文案(集中管理)
├── components/             # Thread / ProcessTimeline / ReferralCard / Sidebar …
├── dev/DevPanel.tsx        # /dev 开发者面板
└── __tests__/              # seam 测试:整树渲染 + fixture SSE 流
```
