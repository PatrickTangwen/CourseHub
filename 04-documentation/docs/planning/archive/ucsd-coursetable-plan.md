# UCSD Course Planning Platform Plan

最后更新：2026-06-19

## 1. 项目目标

基于 Yale 学生开发的 CourseTable fork，开发一个面向 UCSD 学生的选课、查课和排课平台。

这个项目不应该机械复制 CourseTable 的所有功能。CourseTable 里有很多 Yale 专属数据和社交逻辑，例如 Yale OCE 评课、Yalies/profile、friends taking course、Yale area/skill tags、building map、walking time、syllabus 等。UCSD 版本应该保留 CourseTable 最有价值的产品骨架：

- 课程目录搜索
- 课程详情页
- worksheet 选课规划
- 日历排课
- 时间冲突检测
- saved searches / wishlist
- 用户保存课表
- 导出日历
- 高性能课程数据缓存

同时把 Yale 专属功能替换为 UCSD 可持续获取的数据：

- UCSD Schedule of Classes
- UCSD General Catalog
- 你已有的近两年 GPA CSV
- UCSD college GE mapping
- 后续可选的 UCSD SET/CAPE evaluation 数据

MVP 的目标是先做一个可靠的 UCSD 查课和排课工具，而不是一开始就做完整 degree audit 或教授评价平台。

## 2. CourseTable 基线理解

CourseTable 当前主要由两个 repo 组成：

- `coursetable/coursetable`：网站前端、API、用户系统、worksheet、导出、静态 catalog 缓存。
- `coursetable/ferry`：crawler、数据清洗、数据库同步、course eval ingestion、衍生指标计算。

CourseTable 的核心架构是：

1. crawler 抓取课程和评价数据。
2. 数据清洗后写入 PostgreSQL。
3. Hasura 提供课程数据 GraphQL 查询。
4. Express API 处理用户数据、登录、静态 catalog JSON、导出等。
5. React frontend 提供 catalog 和 worksheet 体验。

UCSD 版本建议保留这个大结构，但替换数据源和删除 Yale 专属功能。

## 3. 产品范围决策

### 3.1 保留的 CourseTable 功能

这些功能适合直接保留并改造成 UCSD 版本：

- Catalog 搜索页
- 学期选择
- subject / department 过滤
- course code / title / professor / description 搜索
- days / time 过滤
- course level 过滤
- units / credit 过滤
- seats / enrollment 过滤
- course detail modal/page
- worksheet 选课规划
- 添加和删除课程 section
- calendar view
- list view
- 时间冲突检测
- 多个 worksheet
- saved searches
- wishlist
- shareable worksheet URL
- ICS export
- Google Calendar export
- PNG export，如果移除地图后仍然容易保留
- dark mode
- responsive frontend
- public catalog static JSON cache
- 用户账号系统
- 基础 profile / privacy setting

### 3.2 需要改造成 UCSD 版本的功能

| CourseTable 功能                    | UCSD 版本                                               |
| ----------------------------------- | ------------------------------------------------------- |
| Yale subjects                       | UCSD subjects / departments                             |
| Yale schools                        | UCSD department、division、undergraduate/graduate level |
| Yale area / skill tags              | UCSD college GE mapping                                 |
| Yale OCE overall / workload ratings | GPA / grade distribution stats                          |
| Yale professor rating               | 先不做，后续视 SET/CAPE 数据许可再做                    |
| Yale course requirement metadata    | UCSD Catalog prerequisites + GE metadata                |
| Yale location model                 | MVP 只保留 UCSD building / room 文本                    |
| Yale CAS login                      | UCSD email/OAuth 登录，官方 UCSD SSO 后置               |

### 3.3 先删除或禁用的功能

你已经确认这些功能不做或先不做：

- friends taking course
- catalog 里的 friend count
- friend worksheet viewing
- friend request system
- walking time
- worksheet map
- building map
- syllabus
- past syllabus
- Yale area / skill tags
- Yale requirement tags
- Yale OCE evaluation challenge/access flow
- Yale OCE narrative comments
- Yale AI course eval summaries

这些功能应该从 UI 和数据模型里干净移除，不建议只用 placeholder 隐藏。否则后续会留下大量无效状态和 Yale 残留逻辑。

### 3.4 暂缓的功能

这些功能可以作为后续阶段，不进入 MVP：

- UCSD SET/CAPE integration
- professor evaluation pages
- AI summaries of evaluations
- student-submitted course reviews
- full requirement-aware planning
- major requirement planning
- seat availability history
- recommendation engine

## 4. UCSD 数据源计划

### 4.1 UCSD Schedule of Classes

主数据源：

https://act.ucsd.edu/scheduleOfClasses/scheduleOfClassesStudent.htm

用途：

- 当前和历史 term 的 schedule 数据
- course code
- course title
- section ID
- meeting type
- section code
- days
- start time
- end time
- building
- room
- instructor
- seats available
- seat limit
- course notes
- prerequisite/resource/evaluation links when present

调研结论：

- UCSD Schedule of Classes 是 form-backed HTML。
- 可以通过 POST 请求按 term + subject 抓取。
- 页面支持 subject、department、course code、section id、professor/title 等搜索方式。
- 结果表包含课程、section、meeting、time、location、instructor、seat availability 等信息。
- UCSD 页面标注数据是 nightly updated，所以不能把 seat availability 展示成实时 WebReg 数据。

产品里应该明确显示：

- `Last updated from UCSD Schedule of Classes`
- `Seats available as of UCSD nightly update`
- `Not a real-time enrollment guarantee`

### 4.2 UCSD General Catalog

主数据源：

https://catalog.ucsd.edu/

用途：

- 稳定课程标题
- course description
- units
- prerequisites
- restrictions
- course-level notes
- department course list

原因：

Schedule of Classes 更适合抓 term-specific section 数据，但 course description 和 prerequisites 更适合从 General Catalog 获取。不要只依赖 schedule row 拼出课程详情。

### 4.3 GPA CSV

你已有的数据：

- 近两年的 GPA CSV

MVP 里应把它作为 CourseTable rating 的 UCSD 替代信号，但命名必须准确。

可以计算：

- course-level average GPA
- instructor-course average GPA，如果 CSV 有 instructor
- term-level GPA trend
- grade distribution，如果 CSV 有 grade counts
- sample size
- department percentile
- instructor-course pair history

重要原则：

不要把 GPA 叫做 rating、workload 或 professor quality。GPA 反映的是 grading outcome，不是工作量、教学质量或课程难度本身。

推荐 UI 文案：

- Average GPA
- Grade Distribution
- GPA Trend
- Historical Grading
- Sample Size

### 4.4 UCSD SET / CAPE

相关来源：

- https://set.ucsd.edu/
- https://set.ucsd.edu/student/evaluation-results.html
- https://cape.ucsd.edu/

调研结论：

- CAPE 是旧系统。
- SET 从 Summer 2023 开始替代 CAPE。
- SET/CAPE 是 UCSD 版本最接近 Yale OCE 的数据源。
- 但 SET reports 很可能需要 UCSD 登录。

你已经说明可以用自己的 UCSD 账户登录查看，但担心请求太多导致账户被 block。因此计划上应该明确：

- MVP 不做 SET/CAPE 自动爬取。
- 不用个人 UCSD 账户作为生产数据管道。
- 不在用户访问课程页面时实时请求 SET/CAPE。
- 不做高频 authenticated scraping。

后续更安全的方案：

1. 优先争取 UCSD 官方允许的导出/API/数据访问方式。
2. 如果只能人工访问，则考虑低频、手动 snapshot，但必须确认使用边界。
3. 把 SET/CAPE ingestion 做成独立 pipeline，不和 schedule crawler 混在一起。
4. 所有 evaluation 数据都缓存到本地数据库。
5. 设置严格 request budget 和日志。
6. 页面只读缓存，不触发实时登录请求。
7. 明确显示数据来源和更新时间。

### 4.5 UCSD College GE Mapping

CourseTable 的 Yale area/skill tags 应改成 UCSD college GE mapping。

可能数据源：

- UCSD college websites
- UCSD General Catalog
- official GE requirement pages
- college-specific PDFs or requirement tables

建议先只做 college GE，不要一开始做完整 major planning。

原因：

- UCSD 每个 college 的 GE 结构不同。
- GE requirement 可能按入学年份变化。
- major requirement 更复杂，且会引入 degree audit 级别的问题。

建议数据模型：

- college
- requirement group
- requirement name
- course subject
- course number
- effective academic year
- source URL
- source last checked date
- status: confirmed / needs review / deprecated

UI 表达方式：

- 在 catalog filter 里提供 college GE filter。
- 在 course detail 里显示 GE badges。
- 明确写成 advisory metadata，不承诺替代官方 degree audit。

### 4.6 Building / Location Data

因为 MVP 删除 walking time 和 map，所以初期只需要：

- building text
- room text

不需要：

- building coordinates
- map rendering
- walking ETA
- route calculation

后续如果重新加入地图，可以再建立 UCSD building coordinate table，并考虑 OpenStreetMap、UCSD map source、Google Maps API 或 OpenRouteService。

## 5. 功能设计

### 5.1 Catalog Search

MVP catalog 应支持：

- term selector
- subject filter
- department filter，如果能稳定 normalize
- lower division / upper division / graduate filter
- course code search
- title search
- instructor search
- description search
- days filter
- time range filter
- seats available filter
- units filter
- meeting type filter
- hide full sections
- hide courses conflicting with current worksheet
- sort by course code
- sort by title
- sort by available seats
- sort by meeting time
- sort by average GPA
- sort by GPA sample size
- college GE filter

从 catalog 删除：

- friend count
- friends taking course
- walking time
- map-related fields
- Yale area/skill filters
- Yale rating/workload/professor rating sliders
- Yale evaluation access gating

### 5.2 Course Detail

MVP course detail 应显示：

- course code
- title
- units
- description
- prerequisites
- restrictions
- term
- section list
- meeting type
- days/time
- building/room text
- instructor
- seats available / seat limit
- Schedule of Classes notes
- GPA summary
- grade distribution chart，如果 CSV 支持
- historical GPA by term
- GE badges，如果已接入 GE mapping
- UCSD Schedule source timestamp
- UCSD Catalog source link

从 course detail 删除：

- friends taking course
- syllabus
- past syllabus
- map
- walking time
- Yale OCE narratives
- Yale AI evaluation summaries
- Yale overall/workload/professor rating display

### 5.3 Worksheet

MVP worksheet 应支持：

- add section to worksheet
- remove section from worksheet
- multiple worksheets
- rename worksheet
- clear worksheet
- calendar view
- list view
- conflict detection
- hidden courses
- course colors
- shareable URL
- public/private setting
- ICS export
- Google Calendar export
- PNG export，如果不依赖 map 组件

从 worksheet 删除：

- friends dropdown
- friend worksheet selector
- map view
- walking-time display
- building pins

### 5.4 User Account

MVP 用户功能：

- sign in
- save worksheets
- save searches
- wishlist
- basic profile settings
- public/private worksheet setting

登录建议：

第一阶段优先使用：

- Google OAuth，并限制 `ucsd.edu` 邮箱
- 或 email magic link / verification code

后续再考虑：

- 官方 UCSD SSO app registration

不建议一开始就做：

- 依赖个人 UCSD account 的登录模拟
- unofficial SSO scraping
- friend graph
- friend requests
- Yalies-style profile integration

## 6. 数据管道架构

### 6.1 推荐整体流程

保留 CourseTable 的 crawler -> database -> API/cache -> frontend 的整体形状，但把 Yale Ferry 的数据源替换为 UCSD pipeline。

建议流程：

1. 按 term + subject 抓 UCSD Schedule of Classes HTML。
2. 保存 raw HTML snapshot。
3. 解析 schedule rows。
4. 抓 UCSD General Catalog subject pages。
5. 解析 course description、units、prerequisites。
6. 导入 GPA CSV。
7. normalize term/course/instructor keys。
8. 计算 GPA stats、sample size、GE matches 等衍生字段。
9. 写入 PostgreSQL。
10. 生成 public catalog JSON cache。
11. frontend 用 cache 做快速搜索，用 API/GraphQL 做 detail/user queries。

### 6.2 Raw Data Storage

建议保留原始数据，便于审计和 parser debug：

```text
raw/schedule_of_classes/{term}/{subject}.html
raw/catalog/{subject}.html
raw/gpa/{import_id}.csv
```

每次 import 应记录：

- source URL
- fetch time
- parser version
- row count
- error count
- unmatched row count
- warning summary

### 6.3 核心数据表

建议课程数据表：

- `terms`
- `subjects`
- `courses`
- `course_descriptions`
- `sections`
- `meetings`
- `instructors`
- `section_instructors`
- `buildings`
- `gpa_course_stats`
- `gpa_instructor_course_stats`
- `gpa_term_stats`
- `ge_requirements`
- `ge_course_matches`
- `source_snapshots`
- `import_runs`

建议用户数据表：

- `users`
- `worksheets`
- `worksheet_courses`
- `wishlist_courses`
- `saved_searches`

不进入 MVP 的表：

- friends
- friend requests
- friend worksheet views
- walking-time tables
- map coordinate tables
- Yale evaluation tables
- SET/CAPE tables，直到正式设计评课数据管道

### 6.4 Course Identity

不要用脆弱的字符串 heuristics 来合并课程。

初始 canonical course key：

```text
subject + course_number
```

term-specific section key：

```text
term + section_id
```

如果 UCSD 有 cross-listed courses，不要凭 title 相似度自动合并。只有找到可靠官方来源后，再加入 cross-list mapping。

### 6.5 GPA Matching

GPA CSV 应通过透明的 normalization layer 匹配 schedule/catalog。

推荐匹配字段：

- term
- subject
- course number
- instructor name，如果 CSV 有

每次导入必须输出：

- matched rows
- unmatched rows
- ambiguous matches
- dropped rows，理论上应尽量为 0

不要静默丢弃：

- renamed courses
- instructor spelling variants
- cross-listed courses
- 当前 term 没开但 GPA 历史里存在的课程

## 7. 技术栈

### 7.1 沿用 CourseTable 的部分

Frontend：

- TypeScript
- React
- Vite
- React Router
- Zustand
- Apollo Client / GraphQL
- Bootstrap / React Bootstrap
- Chart.js
- react-big-calendar
- CSS Modules

Backend：

- TypeScript
- Node.js
- Express
- PostgreSQL
- Drizzle ORM
- Hasura GraphQL，如果保留 CourseTable 的 course query 结构
- Redis
- Docker Compose

Data pipeline：

- Python 3.12
- httpx
- BeautifulSoup
- lxml
- pandas
- SQLAlchemy
- psycopg

Observability：

- Sentry，可选但推荐
- structured import logs
- crawler run summaries
- parser failure reports

### 7.2 Package Management

CourseTable upstream 使用 Bun。

因为你计划基于 CourseTable fork 开发，建议第一阶段保留 Bun，避免一开始就重构工具链。

建议：

- CourseTable fork 里的 TypeScript app 继续用 Bun。
- 新 UCSD crawler 用 Python `uv` 管依赖。
- 本地服务用 Docker Compose 管 PostgreSQL、Redis、Hasura。

不要在第一阶段混用 npm/yarn/pnpm/Bun。等 fork 跑通、UCSD 数据模型稳定后，再考虑是否迁移 JS package manager。

### 7.3 需要自己安装或配置的软件

本地开发必需：

- Git
- Docker Desktop
- Docker Compose
- Node.js，版本需兼容 CourseTable 当前 runtime
- Bun
- Python 3.12
- `uv`
- PostgreSQL client tools，例如 `psql`
- code editor

推荐安装：

- `jq`
- `ripgrep`
- browser devtools
- Sentry CLI，如果用 Sentry

### 7.4 需要自己设置的平台或外部服务

大概率需要：

- GitHub repo
- GitHub Actions
- frontend hosting：Cloudflare Pages、Vercel 或类似平台
- backend hosting：Render、Fly.io、Railway、VPS 或类似平台
- managed PostgreSQL：Neon、Supabase、RDS 或类似服务
- managed Redis：Upstash 或类似服务，如果不自托管
- Google OAuth credentials，如果做 Google login 或 Google Calendar export
- Google Calendar API credentials，如果导出流程需要 OAuth
- Sentry project，可选
- domain name

不要把个人 UCSD 账号作为生产服务依赖。

## 8. 实施阶段

### Phase 0: Fork Audit And Local Boot

目标：

让 CourseTable fork 本地跑起来，确认 Yale-specific surfaces。

任务：

- fork CourseTable
- clone fork
- 启动 frontend
- 启动 API
- 启动 Docker Compose services
- 确认 catalog page 能基于现有 fixture/static data 加载
- 梳理 env vars
- 全局搜索 Yale、Yalies、OCE、CAS、skills、areas、friends、walking、map、syllabus 相关逻辑

交付：

- local development runbook
- Yale-specific removal checklist
- 本地启动命令列表

### Phase 1: UCSD Schedule Crawler

目标：

用 UCSD Schedule of Classes 替换 Yale course source。

任务：

- 实现 POST-based Schedule of Classes fetcher
- 按 term + subject 抓取
- 保存 raw HTML snapshot
- 解析 result tables
- 提取 title、units、sections、meetings、instructors、seats、notes、links
- 用已保存 HTML fixture 写 parser tests
- 每次 import 输出 row count、error count、unmatched summary

交付：

- `ucsd_schedule` crawler module
- raw snapshot directory
- normalized schedule output
- parser tests

### Phase 2: UCSD Catalog Crawler

目标：

补全稳定课程描述和 prerequisites。

任务：

- 按 subject 抓 UCSD General Catalog pages
- 解析 title、units、description、prerequisites、restrictions
- 匹配 schedule courses
- 输出 unmatched catalog/schedule report

交付：

- `ucsd_catalog` crawler module
- course metadata tables
- catalog parser tests

### Phase 3: GPA Import

目标：

把 GPA CSV 变成平台的一等数据。

任务：

- 检查 GPA CSV schema
- 定义 term/course/instructor normalization
- 计算 course-level GPA stats
- 如果数据支持，计算 instructor-course stats
- 计算 sample size 和 grade distribution
- 输出 unmatched-row report
- 在 course detail 加 GPA summary 和 chart

交付：

- GPA import script
- GPA stats tables
- course detail GPA module
- import quality report

### Phase 4: Frontend UCSD Catalog

目标：

把 CourseTable catalog UI 改成 UCSD catalog。

任务：

- 替换 Yale-specific copy
- 用 UCSD college GE filters 替换 area/skill filters
- 删除 rating/workload sliders
- 添加 GPA filters/sorting
- 添加 seat availability filters
- 删除 friend indicators
- 删除 syllabus UI
- 删除 map/walking UI entry points
- 显示 schedule source timestamp

交付：

- UCSD catalog page
- UCSD course modal/detail
- GPA-aware sorting/filtering
- source timestamp display

### Phase 5: Worksheet Adaptation

目标：

保留 CourseTable worksheet 的排课能力，删除社交和地图能力。

任务：

- 保留 calendar/list view
- 保留 add/remove section
- 保留 conflict detection
- 保留 worksheet sharing
- 保留 ICS/Google Calendar export
- 删除 friends dropdown
- 删除 map view
- 删除 walking-time computations
- 验证 hidden/color/move 行为

交付：

- UCSD worksheet page
- UCSD meeting data conflict detection
- export support

### Phase 6: UCSD GE Metadata

目标：

用 UCSD college GE mapping 替换 Yale area/skill tags。

任务：

- 先选 1-2 个 college 作为试点
- 找 official GE sources
- 建 GE requirement schema
- 建 sourced GE course mapping
- 加 source URL 和 academic-year versioning
- 加 catalog GE filter
- 加 course detail GE badges
- 添加 advisory wording

交付：

- GE mapping data model
- first college GE dataset
- GE filter UI
- GE badges

### Phase 7: Auth And Saved Data

目标：

支持保存 worksheet、saved searches、wishlist。

任务：

- 选择登录方式
- 实现 UCSD email verification 或 Google OAuth restricted to UCSD email
- 保留 saved searches
- 保留 wishlist
- 保留 private/public worksheet setting
- 删除 friend-related user tables and UI

交付：

- login flow
- saved worksheet persistence
- saved search persistence
- wishlist persistence

### Phase 8: Deployment

目标：

部署可用 beta。

任务：

- 设置 production PostgreSQL
- 设置 backend hosting
- 设置 frontend hosting
- 添加 scheduled crawler job
- 添加 crawler logs and alerts
- 添加 source timestamp display
- 添加 privacy/data disclaimer pages

交付：

- beta URL
- scheduled data refresh
- production database
- deployment runbook

## 9. SET/CAPE 后续计划

Course eval / professor eval 暂时不进入 MVP。

原因：

- SET/CAPE 访问可能需要 UCSD 登录。
- 高频 authenticated scraping 可能影响你的个人账户。
- evaluation 数据可能有政策限制。
- 生产服务不应依赖个人账号和实时登录请求。

后续如果要做：

1. 先确认 UCSD 是否允许这种使用。
2. 优先使用官方导出/API/授权数据。
3. 如果只能人工访问，考虑低频 manual snapshot，但必须确认使用边界。
4. evaluation pipeline 和 schedule pipeline 分离。
5. 所有 evaluation 数据先缓存到数据库。
6. 页面只读缓存，不实时请求 SET/CAPE。
7. 设置 request budget、日志和失败报警。
8. 明确显示 evaluation source 和 last updated。

在这个阶段之前，平台只使用 GPA stats 作为课程结果信号。

## 10. 主要风险和应对

| 风险                                 | 应对                                                 |
| ------------------------------------ | ---------------------------------------------------- |
| UCSD Schedule HTML 结构变化          | 保存 raw snapshot，写 parser tests，parser 失败报警  |
| seat availability 不是实时数据       | UI 明确标注 nightly updated                          |
| GPA CSV 与 schedule/catalog 匹配困难 | 建 normalization layer 和 unmatched report           |
| instructor name 不稳定               | 同时保存 raw name 和 normalized name，不做无证据合并 |
| GE mapping 难维护                    | 按 academic year 和 source URL versioning            |
| SET/CAPE 抓取有账户风险              | MVP 不做，后续只做授权或低频缓存方案                 |
| CourseTable Yale assumptions 很深    | 分阶段删除，先保 catalog/worksheet 主路径            |
| Hasura 增加复杂度                    | 初期保留以减少 fork 改动，数据模型稳定后再评估       |

## 11. MVP 完成标准

MVP 完成时，UCSD 学生应该可以：

1. 选择 term。
2. 搜索 UCSD 课程。
3. 按 subject、level、days、time、seats、units、GPA、college GE 过滤。
4. 打开课程详情，看到 description、prerequisites、sections、instructors、time、location、seats、GPA stats。
5. 把 section 加入 worksheet。
6. 看到日历排课和时间冲突。
7. 保存或分享 worksheet。
8. 导出到 calendar。

MVP 不包含：

- friends
- maps
- walking time
- syllabi
- SET/CAPE evals
- professor ratings
- AI eval summaries
- full degree audit
- major planning

## 12. 参考链接

- CourseTable repo: https://github.com/coursetable/coursetable
- CourseTable architecture docs: https://raw.githubusercontent.com/coursetable/coursetable/master/docs/containers.md
- Ferry crawler docs: https://raw.githubusercontent.com/coursetable/ferry/master/docs/code-structure.md
- Ferry algorithm notes: https://raw.githubusercontent.com/coursetable/ferry/master/docs/algorithms.md
- UCSD Schedule of Classes: https://act.ucsd.edu/scheduleOfClasses/scheduleOfClassesStudent.htm
- UCSD General Catalog: https://catalog.ucsd.edu/
- UCSD SET: https://set.ucsd.edu/
- UCSD SET results info: https://set.ucsd.edu/student/evaluation-results.html
- UCSD CAPE: https://cape.ucsd.edu/

## 13. Grill Session Decisions

新增日期：2026-06-19

这些决定用于后续 PRD 和 GitHub Issues 拆分。它们补充本计划，不覆盖上文的历史内容。

如果本节与上文早期 MVP 范围描述冲突，以本节为准。本节是后续 PRD 和 issue 的当前 scope source of truth。

### 13.1 MVP-1 Scope

MVP-1 不包含登录、用户账号、服务端保存 worksheet、saved searches、wishlist 或 profile/privacy settings。

MVP-1 只包含：

- public catalog search
- course detail
- anonymous worksheet
- worksheet `localStorage` persistence
- shareable worksheet URL
- conflict detection
- ICS export
- GPA display/filter/sort
- UCSD schedule/catalog crawler
- generated Catalog Snapshot

登录、saved worksheets、saved searches、wishlist 和 privacy settings 进入 Beta。

### 13.2 Catalog Snapshot Contract

MVP-1 的前端课程数据读取契约是 `Catalog Snapshot`：每个 supported term 一份自包含 JSON，再加 metadata。

MVP-1 前端主路径不依赖实时 GraphQL 查询。Catalog search、course detail、anonymous worksheet 和 conflict detection 都应能基于 Catalog Snapshot 工作。

### 13.3 Active Planning Term

MVP-1 只支持一个 active planning term 的 schedule snapshot。Term selector 可以隐藏，或只显示这个 term。

Historical GPA Data 仍然导入所有已有 GPA CSV 行，用来计算 course-level 和 instructor-course 历史统计。多 schedule term 支持进入 Beta。

### 13.4 File-First Pipeline

MVP-1 采用 file-first pipeline：

1. 抓取 UCSD Schedule of Classes 和 UCSD General Catalog。
2. 读取 GPA CSV。
3. 保存 raw snapshots。
4. 生成 normalized intermediate artifacts。
5. 生成 `api/static/catalogs/public/{activePlanningTerm}.json`。
6. 生成 `api/static/metadata.json`。
7. 前端直接消费 static files。

Postgres、Hasura 和 live database-backed course queries 不作为 MVP-1 验收依赖。

### 13.5 Future Persistence

后续会添加数据库能力，但分阶段处理：

- Beta-1: 添加 App DB，用于 signed-in users、saved worksheets、saved searches、wishlist 和 privacy settings。
- Beta-2: 评估是否添加 normalized Course Data Store，用于多 term data、import history、crawler audit reports、复杂查询和 snapshot generation source。
- Hasura: 作为 Course Data Store 的候选实现，不是承诺要求。只有当它能明显降低复杂查询、GraphQL codegen 或 CourseTable 兼容成本时再引入。

### 13.6 Course, Section, And Meeting Identity

PRD 和新 UCSD domain language 使用 `Course`、`Section` 和 `Meeting`，不使用 CourseTable/Yale 的 `Listing` 作为产品术语。实现中如果需要兼容旧前端类型，可以在 adapter 层把 Section 映射到旧 `listing` 形状。

MVP-1 identity rules:

- `Course ID` = normalized subject + normalized course number。
- `Section ID` = active planning term + UCSD source section identifier。
- worksheet/share URL 存 Section ID，不存 course title、professor、meeting time 或其他易变字段。
- raw source values 必须保留，包括 raw subject、raw course number、raw section id、raw term。

Meeting model:

- 一个 Section 可以有 0、1 或多个 Meetings。
- TBA / arranged meetings 不参与 time conflict detection，但必须在 UI 显示。
- raw meeting text 必须保留，parser 解析失败时仍能展示来源文本。
- 两个 Sections 只要任意 timed Meeting overlap，就判定为 conflict。

### 13.7 Historical GPA Data Source

MVP-1 的 Historical GPA Data 主源改为 UCSD Instructor Grade Archive：

https://qa-as.ucsd.edu/Home/InstructorGradeArchive

该页面是 POST form，MVP-1 crawler 应按 subject keyword 查询，例如 `CSE`、`MATH`。已验证结果表列为：

- Subject
- Course
- Year
- Quarter
- Title
- Instructor
- GPA
- A
- B
- C
- D
- F
- W
- P
- NP

重要约束：

- A/B/C/D/F/W/P/NP 是百分比，不是人数。
- 页面结果未提供 sample size / total students。
- 因此 MVP-1 不应承诺 sample-size-weighted GPA。
- starter GPA CSV 可保留为 seed/reference/fallback，但不再是主数据源。

MVP-1 GPA ingestion 验收应改为：

- 能 POST 查询 configured subjects。
- 能保存 raw HTML snapshot。
- 能解析 Grade Archive Records。
- 能 normalize subject + course 为 Course ID。
- 能保留 raw year、quarter、title、instructor、GPA 和 grade percentage buckets。
- 能把匹配到 Course ID 的 GPA summary 写入 Catalog Snapshot。

MVP-1 GPA 展示和聚合规则：

- Course detail 显示 raw Grade Archive Records。
- Catalog card/detail 显示 `Archive Avg GPA`。
- `Archive Avg GPA` 是匹配 Grade Archive Records 的 unweighted mean GPA。
- 同时显示 `Record Count`，不显示 `Student Count` 或 sample size。
- Instructor-course 维度可以显示 `Archive Avg GPA` 和 `Record Count`。
- 不做 weighted GPA。
- 不把 GPA 命名为 rating、workload、professor quality 或 recommendation。
- 不把 grade percentage buckets 聚合成严肃分布图，除非 UI 明确写成 average percentage across archive rows。

### 13.8 Configured Subject Scope

MVP-1 使用 configured subject allowlist，不做 UCSD 全量 subject 抓取。

MVP-1 初始 allowlist：

```text
CSE
MATH
```

所有 MVP-1 pipeline 都必须围绕 configured subjects：

- Schedule crawler 只抓 configured subjects。
- Catalog crawler 只抓 configured subjects。
- Instructor Grade Archive crawler 只 POST 查询 configured subjects。
- Catalog Snapshot 只包含 configured subjects。
- UI subject filter 只显示 snapshot 中存在的 subjects。

验收标准：

- 能生成包含 CSE 和 MATH 的 active planning term snapshot。
- 没有 configured subjects 之外的 course 出现在 catalog。
- subject allowlist 可通过配置文件扩展，不需要改 parser 代码。
- parser/import report 输出每个 subject 的 fetched rows、parsed rows 和 errors。

### 13.9 GE Mapping Scope

UCSD college GE mapping 不进入 MVP-1 验收。

MVP-1 可以在 Catalog Snapshot schema 中预留 `ge_matches: []`，但：

- 不实现 GE crawler。
- 不显示 GE filter。
- 不显示 GE badges。
- 不承诺 degree audit 或 college requirement accuracy。

GE mapping 进入 Beta，届时单独定义：

- supported colleges
- official source URLs
- academic-year versioning
- advisory-only wording
- course detail GE badges
- catalog GE filter

### 13.10 Catalog Prerequisites Scope

MVP-1 只从 UCSD General Catalog 提取并显示 prerequisites raw text，不做结构化 prerequisite logic。

Catalog crawler MVP-1 应提取：

- title
- units
- description
- `prerequisites_text`
- `restrictions_text`，如果存在
- `catalog_url`

MVP-1 不做：

- prerequisite graph
- eligibility checking
- boolean prerequisite parsing
- “you can/cannot take this course” 判断
- major/GE requirement reasoning

后续 prerequisite graph / prerequisite logic feature 可以参考：

- [`wllmwu/course-grapher`](https://github.com/wllmwu/course-grapher)：UCSD course planning tool；其 README 描述了从 UCSD online course catalog 解析课程并生成 prerequisite relationship graph 的做法。后续只能作为参考或候选实现来源，不能改变 MVP-1 只展示 raw prerequisite text 的边界。

验收标准：

- CSE/MATH course detail 能显示 catalog description 和 prerequisite 原文。
- parser 抽不到 prerequisite 时留空，不编造。
- raw catalog source URL 保留。
- UI 不显示 eligible / not eligible 判断。

### 13.11 Shareable Worksheet URL

MVP-1 的 shareable worksheet URL 不依赖登录，也不创建 server-side share record。

最小格式：

```text
/worksheet?t={activePlanningTerm}&sections={sectionId1},{sectionId2}
```

规则：

- worksheet state 默认存在 browser `localStorage`。
- share URL 编码 active planning term 和 selected Section IDs。
- 打开 share URL 时，从 Catalog Snapshot 查找 Section IDs。
- 找到的 Sections 加入 Anonymous Worksheet。
- 找不到的 Section IDs 显示 non-blocking warning，不让页面崩溃。
- URL 不存 course title、professor、meeting time 等易变字段。
- MVP-1 不做短链，不做永久 share ID，不保证 schedule 更新后的永久可恢复性。

验收标准：

- 用户添加两个 Sections 后能复制 URL。
- 新 browser/private window 打开 URL 能还原 worksheet。
- URL 中包含不存在的 Section ID 时显示 warning。
- 还原逻辑只依赖 Section ID。

### 13.12 ICS Export Scope

MVP-1 ICS export 导出 Anonymous Worksheet 中 selected Sections 的 timed Meetings。

规则：

- 每个 timed Meeting 生成 calendar event。
- TBA / arranged Meetings 不生成 calendar event。
- 导出前或导出结果 summary 显示 skipped TBA / arranged meeting count。
- Conflicts 不阻止 export，只在 UI 中提示。
- Term Date Range 由配置文件手动配置，不从 UCSD academic calendar 爬取或推断。

Event 字段：

- title: `{subject} {course_number} {section_code} - {meeting_type}`
- location: `{building} {room}`，如果结构化失败则使用 raw location。
- description: course title、instructor、UCSD Schedule of Classes source note。

验收标准：

- Worksheet 中 timed Meetings 能出现在导出的 `.ics` 文件中。
- TBA / arranged Meetings 被跳过并显示 warning/summary。
- 导出不需要登录。
- active planning term 的 start/end dates 来自配置。

### 13.13 Google Calendar Export Scope

Google Calendar direct export 不进入 MVP-1。MVP-1 只做 `.ics` download。

MVP-1 不做：

- Google OAuth
- Google Calendar API credentials
- calendar write permission
- `Add to Google Calendar` direct action

Google Calendar direct export 进入 Beta，最好在 auth / App DB 之后再做。

### 13.14 PNG Export Scope

PNG export 不进入 MVP-1。MVP-1 只保留 shareable worksheet URL 和 `.ics` download。

PNG export 进入 Beta optional，届时需要单独定义视觉验收，包括 calendar grid、long course titles、viewport、dark/light mode 和 mobile/desktop 行为。

### 13.15 MVP-1 Search, Filter, And Sort Scope

MVP-1 search/filter 支持：

- keyword search across subject、course number、title、instructor、description
- subject filter
- course level filter: lower division / upper division / graduate
- days filter
- time range filter
- meeting type filter
- Archive Avg GPA min/max
- hide conflicts with current Anonymous Worksheet

MVP-1 sort 支持：

- course code
- title
- meeting time
- Archive Avg GPA
- Record Count

MVP-1 不做：

- department filter 单独维度
- units filter，除非 Catalog parser 很稳定
- GE filter
- school/division filter
- open seats / seats available filter
- seats available sort
- saved searches
- random course
- list/grid 双视图

MVP-1 只需要保留一种主 catalog view，优先复用 CourseTable 当前最主要的 list/table view。

### 13.16 Real-Time And Dynamic Data Exclusion

MVP-1 和后续路线都不把 open seats / seats available 作为产品功能。即使 UCSD Schedule of Classes 页面提供 “only show sections with seats available”，平台也不实现 open seats filter、seats sort、seat availability display 或 seat availability history。

原因：

- UCSD Schedule of Classes 明确说明信息 subject to change，并且 updated nightly。
- seats availability 容易被用户理解成实时 WebReg 可用性。
- 这个项目的核心价值先定位为 course discovery、historical GPA 和 schedule planning，不做 enrollment availability tracker。

同类实时/动态数据也不进入 MVP-1：

- CourseTable `last_enrollment`
- CourseTable `enrollment` filter/sort
- CourseTable worksheet demand / “in main worksheets”
- friends taking course / friend counts
- real-time WebReg availability
- waitlist availability
- SET/CAPE live authenticated fetches

允许保留的可变数据：

- Schedule section time/location/instructor/title 等 planning fields，可以作为 nightly Catalog Snapshot 的普通 source fields。
- 所有这些 fields 必须带 snapshot/source timestamp 语义，不能暗示实时。

验收标准：

- UI 不出现 open seats、available seats、capacity、waitlist、enrollment、demand、friends taking 等入口。
- Catalog Snapshot 不需要包含 `seats_available`、`seats_limit`、`waitlist`、`capacity`、`enrollment` 或 demand fields。
- 如果 Schedule parser 遇到这些字段，默认忽略；只可作为 raw source debug 信息保留，不进入产品 UI。

### 13.17 Snapshot Generation Failure Policy

MVP-1 Catalog Snapshot generation 采用 fail-hard policy，不接受 partial snapshot。

规则：

- configured subject 中任一核心 source 失败，snapshot generation exit non-zero。
- Schedule parser 失败时，不生成新的 Catalog Snapshot。
- Catalog parser 失败时，不生成新的 Catalog Snapshot。
- Instructor Grade Archive parser 失败时，不生成新的 Catalog Snapshot。
- raw HTML snapshots 仍然保留用于 debug。
- import report 必须写明 failed source、subject、错误行数或失败原因。

验收标准：

- CSE 或 MATH 任一 source/parser 失败时，命令失败。
- 失败时不覆盖现有 `{activePlanningTerm}.json`。
- 成功时才原子性写入新的 Catalog Snapshot 和 metadata。

Snapshot publish 必须经过 validation gate：

- 先生成到 temp/staging directory。
- schema validation 通过后才发布。
- configured subjects 必须存在。
- public payload 不能包含 excluded availability fields。
- 每个 Section 必须有 stable Section ID。
- metadata 必须包含 source timestamps。
- 成功后原子替换 `api/static/catalogs/public/{activePlanningTerm}.json` 和 `api/static/metadata.json`。

额外验收：

- 故意制造 validation failure 时，Published Snapshot 不变。
- 成功发布时 snapshot 和 metadata 拥有同一个 run id / generated_at。
- import report 记录 run id。

### 13.18 MVP-1 Test Strategy

MVP-1 issues 默认按三层测试验收。

#### Parser Fixture Tests

每个 source parser 都必须有 fixture tests：

- Schedule parser: CSE 和 MATH 各至少 1 个 saved HTML fixture。
- Catalog parser: CSE 和 MATH 各至少 1 个 saved HTML fixture。
- Instructor Grade Archive parser: CSE 和 MATH 各至少 1 个 saved HTML fixture。

Fixture tests 至少覆盖：

- TBA / arranged meeting
- multi-meeting section
- missing instructor
- missing GPA / malformed GPA row
- parser 保留 raw source text

#### Snapshot Validation Tests

Snapshot validation tests 必须覆盖：

- schema validation
- rejects missing Section ID
- rejects excluded availability fields
- rejects missing configured subject
- rejects partial generation
- published snapshot atomicity

#### Frontend Behavior Tests

Frontend behavior tests 必须覆盖：

- catalog loads Catalog Snapshot
- keyword search works
- subject filter works
- meeting type filter works
- hide conflicts works
- share URL restores Anonymous Worksheet
- ICS export skips TBA / arranged Meetings

MVP-1 不强制完整 production E2E deployment test，但应有本地 frontend smoke test。

### 13.19 PRD And Issue Slicing Guide

MVP-1 的 issue sequencing 按 vertical risk 排序，不按 UI 页面排序。

建议拆分顺序：

1. Project setup and config
   - configured subjects
   - active planning term
   - Term Date Range
   - output paths
   - run id / report format
2. Instructor Grade Archive crawler/parser
   - POST by configured subject
   - parse Grade Archive Records
   - compute Archive Avg GPA and Record Count
3. UCSD General Catalog parser
   - parse title、units、description、prerequisites_text、restrictions_text、catalog_url
4. UCSD Schedule parser
   - parse Courses、Sections、Meetings
   - handle TBA / arranged
   - handle multi-meeting Sections
   - ignore Availability Data
5. Snapshot schema + validator + atomic publisher
   - combine sources into Catalog Snapshot
   - validation gate
   - Published Snapshot atomicity
6. Frontend snapshot adapter
   - map UCSD Course/Section shape to the UI consumption shape
   - isolate old CourseTable `listing` compatibility behind adapter
7. Catalog MVP UI cleanup
   - remove Yale/friends/evals/availability surfaces
   - implement MVP-1 search/filter/sort
8. Anonymous Worksheet + share URL
   - Section IDs
   - localStorage
   - URL restore
9. Conflict detection + ICS export
   - Meeting overlap
   - TBA skipped with warning
   - Term Date Range
10. Polish / smoke tests / documentation

- MVP-1 acceptance pass
- local runbook
- known limitations

### 13.20 MVP-1 Acceptance Checklist

MVP-1 完成时必须满足：

- One-command snapshot generation succeeds for configured subjects `CSE` and `MATH`.
- Published Snapshot contains only configured subjects.
- Published Snapshot excludes Availability Data、demand、friends 和 eval fields。
- Catalog loads without login、App DB、Course Data Store、Hasura 或 live GraphQL user-path dependency。
- Catalog search/filter/sort MVP set works:
  - keyword search
  - subject filter
  - course level filter
  - days filter
  - time range filter
  - meeting type filter
  - Archive Avg GPA min/max
  - hide conflicts
  - sort by course code/title/meeting time/Archive Avg GPA/Record Count
- Course detail shows:
  - schedule sections
  - meetings
  - instructor
  - building/room text
  - catalog description
  - prerequisites raw text
  - Archive Avg GPA
  - Record Count
  - raw Grade Archive Records
  - source timestamps / source URLs where available
- Anonymous Worksheet supports add/remove Sections.
- Anonymous Worksheet persists in browser `localStorage`.
- Shareable worksheet URL restores selected Section IDs in a new browser/private window.
- Missing Section IDs in a share URL produce a warning, not a crash.
- Conflict detection works for timed Meetings.
- TBA / arranged Meetings do not participate in conflict detection.
- ICS export includes timed Meetings.
- ICS export skips TBA / arranged Meetings and reports skipped count.
- Parser fixture tests pass.
- Snapshot validation tests pass.
- Frontend behavior tests pass.
- MVP user paths contain no Yale、friends、evals、availability、enrollment、waitlist、demand 或 Google Calendar direct export wording.
