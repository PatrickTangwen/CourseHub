# CourseHub 前端 Spec:ChatGPT 式课程问答界面(完全重构)

| | |
|---|---|
| 状态 | 已达成共识,待实施 |
| 日期 | 2026-08-16 |
| 来源 | grilling 设计会话(23 项决策)+ 开源 WebUI 选型调研 |
| 关联 | [CONTEXT.md](../../CONTEXT.md) · [ADR-0001 混合检索](../adr/0001-hybrid-retrieval.md) · [ADR-0002 自定义 SSE 协议 + assistant-ui](../adr/0002-custom-sse-protocol-with-assistant-ui.md) · [后端换皮 Spec](coursehub-retheme.md) |

## 1. 定位与范围

把 `EchoMindFrontend/`(旧 EchoMind 调试控制台,Vue 3)完全重构为面向学生的 **ChatGPT/Claude 式课程问答界面**,同时以"真实过程透明度"承载作品集演示价值。

- **单一界面**:面向学生的干净聊天为主,pipeline 过程展示做成可折叠组件,不做用户/调试双模式。
- **Python-only**:彻底删除 Java 后端切换、旧代理路径与全部客服领域残留。
- **纯聊天形态**:不做独立课程搜索/详情页;结构化内容(课表、教授×学期成绩)由回答文本的 markdown 渲染呈现,**不引入结构化证据卡协议**(避免不必要的前端投入)。
- **目录**:新前端位于 `frontend/`;`EchoMindFrontend/` 删除(git 历史留档)。
- **界面语言**:chrome 文案英文,集中管理便于将来 i18n;回答内容双语自适应是后端行为。
- **主题**:深浅色双主题,默认跟随系统;视觉直接采用 assistant-ui 官方 base 主题(shadcn 中性风格),不做品牌点缀色,不使用校徽/字标;自定义组件(时间线、转介卡、dev 面板)沿用其设计 token。

## 2. 技术栈

| 层 | 选择 | 理由摘要 |
|---|---|---|
| 框架 | React + Vite SPA | 纯静态产物,无 SSR 需求,nginx 直接服务 |
| 聊天运行时/组件 | [assistant-ui](https://github.com/assistant-ui/assistant-ui)(MIT) | `LocalRuntime` + 自定义 `ChatModelAdapter` 对后端协议零侵入;`ToolFallback`/`ToolGroup` 可折叠工具条;`ThreadList` 多会话;详见 ADR-0002 |
| 样式 | Tailwind + shadcn 体系,直接用 assistant-ui base 主题 | 深浅色开箱即得,零品牌定制成本 |
| 测试 | Vitest + React Testing Library | 见 §8 |

## 3. 后端新增(仅 API 层,不动 pipeline 内核)

新增 `POST /chat/stream`(SSE):请求体同 `POST /chat`;在 orchestrator 关键节点发阶段事件,最终答案整段到达。`POST /chat` 原样保留,作为测试入口与流式建立失败时的一次性回退。**已有 127 个后端测试覆盖的逻辑不改**;新端点按现有 pytest 惯例补测试。

### 3.1 SSE 事件协议

`event:` + `data:`(JSON)。事件顺序即 pipeline 真实顺序:

| 事件 | 载荷 |
|---|---|
| `run_started` | `conv_id` |
| `memory_recalled` | 命中的记忆层与条数(工作记忆/情景记忆;不含内容) |
| `intent_recognized` | `intent`、`intent_group`、`intent_confidence`、`intent_source_scores` |
| `routing_decided` | `primary_agent`、`supporting_agents`、`routing_reason`、`routing_confidence` |
| `tool_call_started` | `tool_name` |
| `tool_call_finished` | `tool_name`、`success`、`duration_ms`(无结果数据) |
| `answer` | 完整 `ChatResponse`(与 `POST /chat` 同形) |
| `done` | — |
| `error` | 面向用户的安全信息;细节进日志 |

`tool_call_*` 按实际触发出现零到多次;问候/元问题等不触发检索的请求没有工具事件——"没有工具事件"本身就是"按意图 RAG"亮点的正确呈现。

## 4. 核心交互

### 4.1 聊天主流程

- 多会话侧边栏(assistant-ui `ThreadList`),消息记录持久化在 **localStorage**(会话 id、标题=首问摘要、消息、`conv_id`、更新时间);不新增服务端会话端点。
- 浏览器首次访问生成持久 UUID 存 localStorage 作为 `user_id`,让服务端跨会话画像真实生效。
- `answer` 到达后打字机呈现;markdown 完整渲染(表格、代码块、链接)。

### 4.2 过程时间线(可折叠)

流式期间实时显示当前阶段(替代纯 spinner);完成后收起为一行摘要,点开展开详情。术语用领域友好词,展开层括注原始标识:

| 事件/数据 | 显示(英文 chrome) | 展开详情 |
|---|---|---|
| `run_started` | Thinking… | — |
| `memory_recalled` | Recalling conversation context | 命中层与条数 |
| `intent_recognized` | Understanding the question | intent + 置信度 + **三路融合 source scores** |
| `routing_decided` | Routing to specialists | "Course Agent (lead) · Planning Agent (support)" + `routing_reason` |
| `tool_call_*`(`course_lookup`) | Searching the course index | 耗时、成功状态 |
| `tool_call_*`(语义检索) | Reading course materials | 同上 |
| 未知工具名 | 原始 `tool_name` 兜底 | 同上 |

映射表集中在一个模块维护,与 [CONTEXT.md](../../CONTEXT.md) 词汇对齐(遵守 Avoid 词表)。

### 4.3 领域约束呈现

- **Advisor Referral**:`escalated=true` 渲染独立样式转介卡,列出官方渠道(VAC、系 advisor、WebReg support);语气是"指路"不是报错,绝不出现"转人工"措辞。
- **Planning 免责声明 / 名额快照时间**:后端已在回答文本内强制附带(prompt 层约束),前端原样渲染,不重复、不解析。

### 4.4 错误与空态

SSE 建立失败 → 自动回退一次 `POST /chat`;仍失败 → 错误气泡 + 重试按钮。`/health` 驱动顶部连接状态指示器。空会话给引导示例问题(中英各若干,展示双语能力)。

## 5. Dev 面板(`/dev` 隐藏路由)

不出现在导航;收纳:知识库(add/upload/stats)、monitor 摘要(含工具成功率/延迟)、skills 列表与热重载。无鉴权;生产 nginx 可选择不代理其后端端点。`/eval/run` 不进面板。

## 6. 技术亮点 → UI 落点

「EchoMind 定位与技术亮点」8 项亮点的呈现位置(CourseHub 域对应):

| 亮点 | 落点 |
|---|---|
| 三路意图融合 | 时间线展开:intent + `intent_source_scores` |
| 结构化多 Agent 路由 | 时间线路由阶段:主/辅 Agent + `routing_reason` |
| 按意图 RAG | 工具事件仅在触发时出现 |
| 三级记忆 | `memory_recalled` 阶段 + 稳定 `user_id` 画像演示 |
| 动态 Skills | `/dev` skills 列表 + 热重载 |
| MCP 工具治理 | 时间线工具耗时/状态;`/dev` monitor 工具统计 |
| Monitor 路由降权 | `/dev` monitor 摘要 |
| LLM-as-Judge 评测 | 不进 UI(API/CLI);README 叙述 |

## 7. 部署

- 前端并入 `EchoMind/docker-compose.yml`:多阶段构建产出静态 `dist`,由现有 nginx 容器服务,并代理 API 与 SSE(`proxy_buffering off`、加长 `proxy_read_timeout`)。
- 从 `EchoMind/` 一条 `docker compose up` 起完整演示;删除 `EchoMindFrontend/` 独立 Dockerfile/Compose 及 `host.docker.internal` 旧姿势。
- 本地开发:`npm run dev`,Vite 代理到 `localhost:8000`。

## 8. 测试

- **前端(Vitest + RTL)**,优先级序:① SSE 帧解析与 adapter 事件→UI 映射(fixture 流,含乱序/截断/error 帧)——自定义协议的"活契约";② 过程时间线状态机;③ Advisor Referral 卡触发;④ localStorage 会话持久化往返。
- **后端(pytest)**:`/chat/stream` 事件顺序、`answer` 与 `/chat` 同形性、错误路径。
- 不引入 Playwright(留待真实回归出现后)。

## 9. 验收标准

1. `EchoMind/` 下 `docker compose up` 后,`:80` 提供新前端,真实后端联通可聊。
2. 课程问题触发时间线依序实时显示各阶段,答案打字机呈现;完成后时间线收起,可展开看意图分数、路由理由、工具耗时。
3. 命中多 Agent 的问题显示主/辅 Agent。
4. `escalated=true` 显示 Advisor Referral 卡及官方渠道。
5. Planning 回答的免责声明、名额回答的快照时间在渲染中完整可见。
6. 中文提问得中文回答,界面 chrome 保持英文。
7. 多会话新建/切换/删除,刷新后 localStorage 恢复;`user_id` 跨会话稳定。
8. `/dev` 可见知识库统计、skills 热重载生效、monitor 摘要渲染。
9. 深浅色主题均正常,默认跟随系统。
10. SSE 断连回退 `POST /chat` 生效;后端离线时错误态清晰可重试。

## 10. 明确不做(本期)

Token 级流式(升级路径:新增 `answer_delta` 事件,不破坏现有事件)、AG-UI 协议、结构化证据卡、Playwright e2e、界面 i18n 切换、服务端会话列表端点、eval UI。
