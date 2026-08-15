# UCSD / SunGrid 课程数据官方链接总表

核验日期：**2026-08-15（America/New_York）**

范围：只收录本仓库实际使用或明确引用的课程数据源、UCSD 官方过渡资料，以及本网站公开发布接口。没有复制大型 JSON、没有访问个人账户、没有记录 Cookie、令牌或密钥。

状态说明：

- **现场可用**：2026-08-15 直接访问或查询成功。
- **仓库约定**：来自当前代码/ADR；不代表 UCSD 对第三方承诺的稳定 API 合同。
- **受限/现场不可用**：需要交互式 SSO，或本次查询失败。

## 一、网站实际使用的四类课程数据源

### 1. UCSD General Catalog：课程定义与描述

**状态：现场可用。** 当前首页为 **2026–27 Catalog of Record**。

- [General Catalog 首页](https://catalog.ucsd.edu/)
- [Courses, Curricula, and Faculty 索引](https://catalog.ucsd.edu/front/courses.html)
- [CSE 课程页示例](https://catalog.ucsd.edu/courses/CSE.html)
- [历年 Catalog of Record 归档](https://catalog.ucsd.edu/archive/index.html)
- 主题页规则：`https://catalog.ucsd.edu/courses/{SUBJECT}.html`

仓库用途：按 subject 抓取课程号、标题、units、description、prerequisites、restrictions、交叉列课信息和源链接；实现见 [`generalCatalog.ts`](../05-pipeline-and-schema/tools/catalog-snapshot/generalCatalog.ts) 与 [`snapshot_pipe.md`](../04-documentation/docs/snapshot_pipe.md)。课程页面是 Catalog of Record；其首页同时提醒课程信息仍可能发生变更，历史 term 若需精确描述，应优先核对官方归档，而不是把当前页面强行套到过去。

### 2. Legacy Schedule of Classes：Summer 2026 及此前的排课/座位快照

**状态：现场可用；页面明确写明 nightly 更新，不是实时 WebReg。**

- [Schedule of Classes 搜索页](https://act.ucsd.edu/scheduleOfClasses/scheduleOfClassesStudent.htm)
- [表单结果端点](https://act.ucsd.edu/scheduleOfClasses/scheduleOfClassesStudentResult.htm)
- [S126 subject list](https://act.ucsd.edu/scheduleOfClasses/subject-list.json?selectedTerm=S126)
- [S226 subject list](https://act.ucsd.edu/scheduleOfClasses/subject-list.json?selectedTerm=S226)
- [S326 subject list](https://act.ucsd.edu/scheduleOfClasses/subject-list.json?selectedTerm=S326)
- [FA26 subject list（当前为空）](https://act.ucsd.edu/scheduleOfClasses/subject-list.json?selectedTerm=FA26)
- 模板：`https://act.ucsd.edu/scheduleOfClasses/subject-list.json?selectedTerm={TERM}`

2026-08-15 现场结果：

| term   | subject 数 | 说明                                      |
| ------ | ---------: | ----------------------------------------- |
| `S126` |         76 | legacy SoC 仍服务                         |
| `S226` |         78 | legacy SoC 仍服务                         |
| `S326` |         41 | legacy SoC 仍服务                         |
| `FA26` |          0 | Fall 2026 已转向 TSS / Class Planner 来源 |

按仓库当前表单参数 POST `S326 + CSE` 返回 HTTP 200；结果页标注 `As of: 08/15/2026, 02:17:00`。搜索首页则明确写着 `Information is updated nightly`。所以这些 seat/capacity/waitlist 值只能叫带时间戳的快照，不应叫实时座位。

仓库先读每个 term 的 `subject-list.json`，再按 subject POST 结果端点并处理分页/Cookie；实现见 [`scheduleOfClasses.ts`](../05-pipeline-and-schema/tools/catalog-snapshot/scheduleOfClasses.ts)。普通读者应从搜索页操作，不要把结果端点误当成稳定 GET API。

### 3. UCSD Class Planner 公共 JSON API：FA26+ 首选排课源

**状态：现场可用；当前仓库首选 FA26+ 排课源。** 这是 UCSD `apps.ucsd.edu` 下无需 SSO 的公开 JSON 接口，但没有发现面向第三方的版本/稳定性承诺。

- [Class Planner Guide](https://classplanner.apps.ucsd.edu/)
- [term registry](https://classplanner.apps.ucsd.edu/api/v1/planner/terms)
- [FA26 filters / subject universe](https://classplanner.apps.ucsd.edu/api/v1/catalog/filters?term_code=FA26)
- [FA26 courses 分页示例（1 条）](https://classplanner.apps.ucsd.edu/api/v1/catalog/courses?term_code=FA26&limit=1&offset=0)
- 完整分页模板：`https://classplanner.apps.ucsd.edu/api/v1/catalog/courses?term_code={TERM}&limit=48&offset={N}`
- [UCSD ESR：TSS / Class Planner 项目与新闻索引](https://esr.ucsd.edu/projects/student/ecosystem/core-sis.html)
- [历史官方通知链接：A New Class Planner Option](https://adminrecords.ucsd.edu/Notices/2026/2026-7-24-1.html)（2026-08-15 已重定向到新的 Campus Notices 门户，不再直接显示原通知正文）

2026-08-15 现场观测：

- `/planner/terms` 只列 `FA26`，`configured: true`；`last_full_refresh_at` 为 `2026-08-15 15:41:38+00`，同时列出 2,156 courses、7,563 sections、11,369 meetings。
- `/catalog/filters?term_code=FA26` 返回 174 个 subjects。
- `/catalog/courses?...limit=1&offset=0` 返回 `total: 2257`。

term registry 的 `course_count` 与分页端点的 `total` 在查询时不一致，可能来自刷新时差或统计口径差异；接口没有解释原因，因此这里只原样保留两个观测值，不把它们说成稳定相等。Class Planner Guide 也明确提醒 seat counts 会变化、选 section 不会保留座位，最终必须到 TSS 核对并 booking。

仓库决策与抓取器见 [`ADR 0040`](../04-documentation/docs/adr/0040-use-public-class-planner-api-as-schedule-source.md)、[`classplannerCatalog.ts`](../05-pipeline-and-schema/tools/classplanner-scraper/classplannerCatalog.ts) 和 [`snapshot_pipe.md`](../04-documentation/docs/snapshot_pipe.md)。官方 2026-07-24 通知说明 Class Planner 从 TSS Schedule of Classes 持续取数、用于规划而非 booking。

### 4. UCSD A.S. Instructor Grade Archive：Past Grades

**状态：页面现场可用，但查询操作在本次核验时不可用。**

- [Instructor Grade Archive](https://qa-as.ucsd.edu/Home/InstructorGradeArchive)

GET 返回 HTTP 200，表单可见 Quarter、Year、Instructor、Subject、Code。仓库使用相同页面并按 `quarter/year/instructor/subject/courseNumber` POST；2026-08-15 用有效 `subject=CSE`（含更窄 course/year 组合、带或不带 GET Cookie）均返回 HTTP 500。因此只能确认入口仍在线，不能声称当前可成功抓取。仓库已保存/已发布的历史 grade rows 仍属于可审计的既有数据，但刷新时应把这次源故障显式报告出来。

仓库用途：Past Grades 的 subject/course/year/quarter/instructor/GPA 和 A/B/C/D/F/W/P/NP 百分比；实现见 [`instructorGradeArchive.ts`](../05-pipeline-and-schema/tools/catalog-snapshot/instructorGradeArchive.ts) 和 [`ADR 0003`](../04-documentation/docs/adr/0003-instructor-grade-archive-for-historical-gpa.md)。

## 二、term code 的官方边界与仓库映射

- [UCSD Blink：June Retrofit Release](https://blink.ucsd.edu/instructors/student-reporting/tss-transition/june-retrofit.html) 明确写明：普通本科/研究生 academic terms 使用 4 字符代码（例 `FA26`）；`FA26` 之前来自 ISIS，`FA26` 起来自 TSS。Medicine/Pharmacy calendar 可能使用 5 字符版本。
- **仓库约定**：[`termWindow.ts`](../05-pipeline-and-schema/tools/catalog-snapshot/termWindow.ts) 将 `WI`、`SP`、`S1`、`S2`、`S3`、`FA` 加两位年份，映射为 Winter、Spring、Summer Session I、Summer Session II、Special Summer Session、Fall。它通过 live subject-list 是否非空决定 legacy Term Window，不声称这是 UCSD 所有 calendar 的完整编码标准。
- FA26 的 TSS/Class Planner 课程号采用新格式（如 `MATH-018`），UCSD 的 [Preparing to Book Courses](https://students.ucsd.edu/academics/enroll/booking-guide.html) 说明旧 `MATH 18` 与新格式直接对应。

## 三、TSS / WebReg / Schedule of Classes 官方过渡资料

这些页面用于判断来源边界与产品文案，不是本仓库的可调用课程 API。

### 当前最有用的官方页面（2026-08-15 可读）

- [UCSD Student Tools](https://students.ucsd.edu/my-tritonlink/tools/index.html)：明确区分 Fall 2026 的 TSS/Schedule of Classes 与 Summer 2026 的 WebReg/legacy Schedule of Classes。
- [Preparing to Book Courses](https://students.ucsd.edu/academics/enroll/booking-guide.html)：2026-08-03 更新；说明 Fall 2026+ 在 TSS booking，列出新的课程号格式与 booking window。
- [Booking Courses with TSS](https://students.ucsd.edu/my-tritonlink/tools/tool-help/booking.html)：2026-08-12 更新；说明如何在 TSS Schedule of Classes 搜索、查看详情和 booking。
- [WebReg Tutorial](https://students.ucsd.edu/my-tritonlink/tools/tool-help/webreg-tutorial/index.html)：legacy WebReg 教程；页面明确 Fall 2026+ 改用 TSS。
- [TSS Schedule of Classes Updates and Known Issues](https://esr.ucsd.edu/news/posts/sis-tss-soc-known-issues-aug-2026.html)：2026-08-11；说明 Fall 2026 SoC 已用于 planning/booking，但仍有已知问题，限制/先修可能来自 ISIS 历史记录或 CourseLeaf approvals。
- [TSS Schedule of Classes Functionality](https://esr.ucsd.edu/news/posts/sis-tss-schedule-of-classes-functionality-jul-26.html)：说明初始 TSS SoC 功能差异、已知限制和 CourseLeaf enrollment-requirement 来源；这不是 API 文档。
- [TSS Training](https://blink.ucsd.edu/instructors/resources/tss/index.html)：2026-08-11 更新；说明 Booking 是 TSS 中 registration/enrollment 的新称呼，并给出 scheduling、waitlist 等培训资料。
- [TSS project / Core SIS](https://esr.ucsd.edu/projects/student/ecosystem/core-sis.html)：TSS 总入口、新闻和迁移背景。
- [历史 TSS Access notice](https://adminrecords.ucsd.edu/Notices/2026/2026-7-10-1.html)：2026-07-10 校方 access/launch 通知的原链接；2026-08-15 已重定向到新的 Campus Notices 门户，当前迁移事实应以 [TSS project / Core SIS](https://esr.ucsd.edu/projects/student/ecosystem/core-sis.html) 和学生帮助页为准。
- [TSS role/access KBA](https://support.ucsd.edu/its?id=kb_article_view&sysparm_article=KB0036314)：角色/访问入口；不是匿名课程数据 API。

### 交互式或受限入口

- [TSS Schedule of Classes / Fiori](https://tss.ucsd.edu/fiori)：可到达交互式 Fiori 页面，但不是可匿名读取的 JSON 合同。
- [Triton Student System login](https://sis.ucsd.edu/)：会转到 TSS/Fiori，booking 最终权威入口；需要正常浏览器/SSO 交互。
- [TSS: Impact on Students（当前官方链接）](https://docs.google.com/document/d/12akzJgIUJA6xGc9vPfTDZ76-9ZbVVa4Lqw2O9kiG9gs/edit?tab=t.0)：浏览器依赖 JavaScript/可能要求登录，不是运行时数据源。
- [仓库归档曾引用的 application-impact Doc](https://docs.google.com/document/d/1fHj8FpxVfecCMlojX64OC6fLsoRJNTp4xzrLUsroZ_I/edit?tab=t.0)：只作为迁移研究上下文保留；不能据此推断公共 API。仓库归档见 [`tss-webreg-transition-links-2026-07-18.md`](../04-documentation/docs/planning/archive/tss-webreg-transition-links-2026-07-18.md)。

结论：legacy SoC 的公开 HTML/JSON 与 Class Planner 的公开 JSON 均可读取；TSS/Fiori 本身没有在这些官方页面中提供第三方实时 seats API 合同。不要把培训页、登录页、CourseLeaf 说明或 Google Doc 当成 API。

## 四、CAPE / SET：仓库明确引用但不摄取

- [CAPE](https://cape.ucsd.edu/)：现场可读；官方页面写明最后一个 quarter 是 Spring 2023，Summer 2023 起由 SET 替代。
- [SET](https://set.ucsd.edu/)：现场可读；官方页面说明 SET 自 2023 起替代 CAPE。

**仓库约定：不 ingest CAPE/SET。** [`ADR 0003`](../04-documentation/docs/adr/0003-instructor-grade-archive-for-historical-gpa.md)、[`CONTEXT.md`](../04-documentation/repository-root/CONTEXT.md) 与 [`README.md`](../04-documentation/repository-root/README.md) 选择 Instructor Grade Archive 作为 Past Grades 来源，并明确排除 SET/CAPE 和个人 UCSD 账户抓取。所以上述链接仅用于解释“为什么没有评价数据”，不能与 GPA/grade archive 混称。

## 五、SunGrid 公开发布链接与私有 R2 边界

### Production（现场可用）

- [Production metadata registry](https://sungridplanner.com/api/catalog/metadata)
- [FA26 Catalog list JSON](https://sungridplanner.com/api/catalog/public/FA26)（大型 JSON）
- [FA26 Past Grades/detail JSON](https://sungridplanner.com/api/catalog/details/FA26)（大型 JSON，按页面需求加载）
- 模板：`https://sungridplanner.com/api/catalog/public/{TERM}`
- 模板：`https://sungridplanner.com/api/catalog/details/{TERM}`

2026-08-15 最后复核：metadata HTTP 200，`last_update: 2026-08-13T11:00:06.839Z`，共 15 个 terms，registry 的首项为 `S324`、末项为 `FA26`。应始终先读 metadata 确认可用 term，不要硬编码列表。metadata/list/details 都返回 `application/json` 和 `Cache-Control: public, max-age=3600`；当时响应大小约为 7.4 KB / 8.19 MB / 6.75 MB。当前 FA26 list/detail 均为 HTTP 200；它们是发布快照，不是打开页面时向 UCSD 发起的实时查询。

### Staging（现场可用，但不是稳定用户数据入口）

- [Staging metadata](https://staging.sungridplanner.com/api/catalog/metadata)
- 模板：`https://staging.sungridplanner.com/api/catalog/public/{TERM}`
- 模板：`https://staging.sungridplanner.com/api/catalog/details/{TERM}`

Staging 用于候选版本验证，内容可能先于/不同于 Production；引用课程事实时默认使用 Production 加官方 UCSD 系统复核。

### R2 与 manifest：没有公开对象 URL

metadata 中的 `snapshot_path`、`detail_path`、`manifest_path`（如 `published-snapshots/...`）是**私有 R2 object keys**，不是可以拼接的公开 URL。当前 Worker 只公开 metadata、list、details 三类 Catalog read routes；[`worker/wrangler.jsonc`](../05-pipeline-and-schema/worker/wrangler.jsonc)、[`ADR 0035`](../04-documentation/docs/adr/0035-use-only-the-staging-product-origin.md) 与 [`worker_catalog.md`](../04-documentation/docs/worker_catalog.md) 明确关闭 `workers.dev`、preview URLs 和 `r2.dev` 暴露。

- [不存在的 manifest API 示例](https://sungridplanner.com/api/catalog/import-manifests/FA26)：2026-08-15 返回 404。

因此不要发布 R2 bucket 名、S3 端点、access key，也不要把 metadata 里的 object key 当下载链接。需要 manifest 时应使用仓库内随 package 提供的审计材料或经授权的发布工具，而不是绕过 Worker。

## 六、快速选择

| 需要什么                                  | 应使用的权威入口                                                                                  | 重要限制                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 当前课程定义、描述、先修                  | [General Catalog](https://catalog.ucsd.edu/)                                                      | Catalog of Record 不是某个过去 term 的完整排课快照 |
| Summer 2026 排课、section、旧式 seat 快照 | [legacy Schedule of Classes](https://act.ucsd.edu/scheduleOfClasses/scheduleOfClassesStudent.htm) | nightly，不是实时                                  |
| FA26+ 排课、section、meeting、seat 快照   | [Class Planner API registry](https://classplanner.apps.ucsd.edu/api/v1/planner/terms)             | 公开但无第三方稳定合同；最终以 TSS booking 为准    |
| 历史 GPA / grade buckets                  | [Instructor Grade Archive](https://qa-as.ucsd.edu/Home/InstructorGradeArchive)                    | 2026-08-15 POST 查询为 500；不要冒充当前可刷新     |
| SunGrid 已发布内容/term registry          | [Production metadata](https://sungridplanner.com/api/catalog/metadata)                            | 定期发布快照；R2 私有                              |
| 最终选课/座位确认                         | [TSS](https://sis.ucsd.edu/)                                                                      | 交互式 SSO；不是本仓库 API                         |
