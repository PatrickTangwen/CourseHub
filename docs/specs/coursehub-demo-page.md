# CourseHub 双语静态 Demo 页 Spec:GitHub Pages 实录回放

| | |
|---|---|
| 状态 | 设计已确认,待实施 |
| 日期 | 2026-08-16 |
| 来源 | grilling 设计会话(Q1–Q11,11 项决策) |
| 关联 | [CONTEXT.md](../../CONTEXT.md)(Demo 词汇) · [ADR-0003 Demo Mode 复用真前端](../adr/0003-demo-mode-replays-recorded-sessions.md) · [前端 Spec](coursehub-frontend.md) |

## 1. 定位与范围

在 GitHub Pages 上发布一个公开的静态 demo,让**招聘方/导师在 30 秒内**感受到"这是一个部署在本地的完整实时产品"。

- **受众**:招聘方/导师,扫一眼为主,不假设会动手深挖——第一屏必须直接呈现最丰富的状态。
- **UI 逐像素一致**:复用 `frontend/` 代码库构建,demo 差异只存在于应用壳**外**(诚实横幅)与数据源边界;不做独立复刻。
- **双语活在对话内容里**:chrome 保持英文(与真实页一致),预录会话中英混排。
- **完全中文页 + 语言切换**(2026-08-17 用户修订,推翻原"不加语言切换钮"决定):`/CourseHub/zh/` 提供 chrome 全中文的镜像页(构建时以 `strings.zh.ts` 整体替换文案模块,生产代码不变);横幅上的 中文/English 按钮在两页间切换并保留当前子路径。EXAMPLE_PROMPTS 两版逐字一致(须匹配实录)。
- **诚实原则**:预录回放明示;时间线事件、答案、面板数据全部实录自真实本地部署,不编造。

## 2. 架构:构建时替换数据源

- Vite demo 模式(独立构建入口/flag),正常 `build` 与 43 项前端测试零影响,demo 代码不进正常产物。
- API 边界三处(`chatApi` / `chatAdapter` / `DevPanel` 的 fetch)替换为 demo 数据源;应用其余部分原样复用。
- 术语以 [CONTEXT.md](../../CONTEXT.md) Demo 节为准:**Demo Mode / Recorded Session / Demo Notice**。取舍记录在 ADR-0003。

## 3. 实录与回放

- **采集**:本地起真后端,脚本实录 `POST /chat/stream` 全事件流(含相对时间戳)与 `/monitor`、`/skills`、`/knowledge/stats` 响应快照;fixture 必须通过前端严格 `decodeStageEvent`。
- **六条 Recorded Session**(覆盖全部 UI 状态):
  1. "What does CSE 100 cover?"(英,知识检索)
  2. "Who teaches CSE 101 in FA26?"(英,课程索引查询)
  3. "CSE 100 有哪些先修要求?"(中)
  4. "帮我规划 CSE 100 和 CSE 110 的修课顺序"(中,GFM 表格 + 免责声明)
  5. Advisor Referral 触发条(引荐卡)
  6. 多轮追问条(`conv_id` 延续)
- **节奏**:阶段流等比压缩至 2–3 秒(各阶段相对时长保持实录比例);打字机沿用生产参数(4 字符 / 12ms)——生产本就是整段到达后打字机呈现,demo 手感与真实部署一致。
- **回放触发**:4 个示例提问按钮;自由输入经规范化(trim、空白折叠、英文大小写归一)后与剧本问题**精确匹配**也触发回放。
- **同名去重**:回放产生与既有会话同名的线程时只留一条,存活者按 threadStore 的 lastMessageAt 判定(新回放必然最新,访客正看的会话绝不被删);去重推迟到线程状态通知周期之外执行。(2026-08-17 用户修订)

## 4. 交互

- **初始状态**:首次访问把六条完成态会话播种进 localStorage(走真实 threadStore 机制),落地为**空欢迎页**(欢迎语 + 示例提问,与真实首访一致),六条会话在侧边栏等待点开;再次访问不重复播种。(2026-08-17 用户修订;原设计为落地选中修课规划条)
- **自由输入(Demo Notice)**:输入含任一 CJK 字符 → 中文 Notice,否则英文;Notice 是"说明"不是假装的模型回答——无过程时间线,附可点的建议问题;不做关键词模糊匹配。
- **开发者面板**:实录快照渲染;添加文档/上传/重载技能**假成功**,作用于内存状态(统计数字真实变化、通知条显示),刷新复位。skills 的名称/描述与告警文案在**英文页**显示英文标注(仅 demo 层映射,规则正文保持实录原文);**中文页**保持实录中文原文。(2026-08-17 用户修订)
- **健康点**:恒 Connected,不发任何请求。
- **诚实横幅**:应用壳外上方一条细横幅,可关闭,英文为主附一句中文,说明"预录自真实本地部署"并链接 GitHub 仓库;横幅以下 DOM 与真实应用一致。
- **禁词**:所有 demo 文案遵守 CONTEXT.md Avoid 词表(绝不出现"转人工 / human handoff")。

## 5. 部署

- GitHub Actions:push `main` → 双语构建(`build:demo:site`,英文 `dist-demo/` + 中文 `dist-demo/zh/`)→ 发布 Pages;地址 `https://patricktangwen.github.io/CourseHub/` 与 `/CourseHub/zh/`。
- `/zh/` 子树深链:根 404.html(英文构建产出)注入重定向脚本,原始路径经 sessionStorage 带回、demo 入口渲染前还原(spa-github-pages 惯用法)。
- Vite `base` 设 `/CourseHub/`;`App.tsx` 路径判断改为 base 感知(主代码小修正);`/dev` 深链走 GitHub Pages 标准 `404.html` 回退。
- README 中英两份顶部加 Live Demo 链接;仓库 homepage 字段指向 demo。
- **push 与开启 Pages 须经用户批准后执行。**

## 6. 测试

- demo 数据源走既有前端 seam(RTL 整树渲染 + fixture),并断言 demo 构建**零真实网络请求**。
- 现有 43 项前端测试保持全绿;Docker/nginx 部署链路不受影响。

## 7. 验收标准

1. 打开 Pages 地址,落地为欢迎页(欢迎语 + 中英示例提问),侧边栏六条中英混排会话;点开修课规划条可见完整渲染(表格、免责声明、收起的时间线可展开)。
2. 点击示例提问,时间线以等比压缩节奏实时逐阶段推进,答案打字机呈现。
3. 中文自由输入得中文 Demo Notice,英文得英文;规范化后精确匹配剧本问题则回放对应会话。
4. `/dev` 呈现实录快照(skills 名称/描述为英文标注);添加文档假成功且统计数字变化,刷新后复位;健康点恒 Connected。
5. 横幅可关闭;横幅以下渲染与本地真实部署一致。
6. `/` 与 `/dev`(含深链直达)在 `/CourseHub/` base 下均正常。
7. 正常构建、43 项前端测试、Docker 部署链路不受影响。
8. 页面全程无任何真实网络请求(纯静态自足)。
9. `/CourseHub/zh/` 的 chrome(欢迎语、输入框、侧边栏、时间线、开发者面板)全中文;横幅切换按钮双向工作且保留当前子路径(含 `/dev`)。

## 8. 明确不做(本期)

UI 语言切换钮、真后端托管(HF Space 等)、自由问答的关键词/模糊匹配、token 级流式、Playwright e2e、访问统计。
