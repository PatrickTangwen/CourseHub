# SunGrid / CourseTable UCSD 课程资料包

整理日期：2026-08-15（America/New_York）

这是一个面向课程数据、课程文档、来源链接和数据管线的自包含资料包。它把“网站当前实际发布的数据”和“本机保存的完整历史采集档案”分开，避免把旧的原始抓取误当成线上当前快照。

## 最快入口

- 想直接用网站当前课程数据：打开 `01-current-published-data/api/static/catalogs/public/`。
- 想查每个学期有多少课程、Section、Meeting：打开 `00-index/terms-summary.csv`。
- 想查某门课的 UCSD Catalog 链接：打开 `00-index/course-catalog-links.csv`。
- 想看已核实的官方数据来源：打开 `03-links/official-course-data-links.md`。
- 想查资料包内全部 URL：打开 `00-index/all-reference-urls.csv`。
- 想定位任意文件：打开 `00-index/file-manifest.csv`。
- 想理解字段：打开 `00-index/data-dictionary.md`。

## 当前发布数据概览

当前发布数据来自 2026-08-15 实时确认的远端 `main`：

- Git commit：`009b922ff3cd87344c30f5923b3920619e50caf7`
- 数据生成时间：`2026-08-13T11:00:06.839Z`
- 学期：15
- 学期-课程记录：19,041
- Sections：61,496
- Meetings：165,447
- Instructor Grade Archive records：15,138
- 学期-课程 Catalog URL 记录：16,825

这些课程数是跨学期记录数，同一门课在多个学期出现会分别计数。

## 目录结构

### `00-index/`

资料包索引和可重复生成脚本：

- `inventory-summary.json`：总体统计。
- `terms-summary.csv`：逐学期统计和 Import Manifest 状态。
- `course-catalog-links.csv`：每个学期、Course ID、课程标题与官方 Catalog URL 的映射。
- `all-reference-urls.csv`：发布快照、文档、管线代码和 TSS 辅助资料中提取的去重 URL。
- `file-manifest.csv`：资料包内每个文件的相对路径、字节数、扩展名和所属分组。
- `build-inventory.mjs`：重新生成上述索引的无依赖 Node.js 脚本。

### `01-current-published-data/`

网站当前 Published Snapshot 数据包含两种等价表示：

- `live-production-api-2026-08-15/`：2026-08-15 从 Production 实际下载的 metadata、15 个 term 的 list JSON、15 个 details/Past Grades JSON，以及逐请求 HTTP/ETag/字节数清单；共 31 个 HTTP 200 响应、87,786,257 bytes。
- `api/static/`：直接从远端 `main` 导出的可审计仓库表示，没有改变本地工作树。

仓库表示包括：

- `api/static/metadata.json`：网站支持的学期、标签、日期范围和当前数据时间。
- `api/static/catalogs/public/*.json`：15 个学期的完整课程快照。
- `api/static/catalogs/import-manifests/*.json`：每个来源/学科单元的成功、空、失败、部分状态及数据来源路径。
- `frontend/src/generated/supported-terms.json`：前端生成的支持学期列表。

Production 为降低页面传输量，把每个 term 拆成 list 与 details；仓库 JSON 是合并表示。`00-index/package-validation-report.json` 已证明 15 个 term 的线上 list + details 都能精确重建对应仓库快照。

### `02-complete-local-data-history/`

本机仓库中截至整理时保存的完整课程数据历史，逻辑大小约 8.3 GB，共 53,837 个文件：

- `data/raw/`：Schedule of Classes、General Catalog、Instructor Grade Archive、Class Planner 等原始响应/HTML/JSON。
- `data/normalized/`：按运行和学期保存的标准化课程、Schedule、Catalog、成绩档案数据。
- `data/reports/`：导入报告、ETL refresh 报告和刷新前 Published Snapshot 记录。
- `data/logs/`：本地刷新日志。
- `TSS_相关资料/`：FA26 TritonGPT/TSS CSV、手工响应、转换结果和容量补充材料。
- `exports/tritongpt_fa26_capacity/`：FA26 容量数据导出及审计记录。

此目录使用 APFS 写时复制创建：文件 inode 与原始仓库独立，修改资料包不会修改仓库；在当前磁盘上初始额外占用远小于 8.3 GB。把它复制到普通磁盘或压缩时，应按约 8.3 GB 的真实数据量预留空间。

### `03-links/`

- `official-course-data-links.md`：以 UCSD 官方页面和仓库实现为主的来源核查，区分已实时验证、仅仓库可见、登录/权限限制和并非公开 API 的链接。

### `04-documentation/`

远端 `main` 上的完整 `docs/` 目录。课程相关的首要文档包括：

- `docs/snapshot_pipe.md`
- `docs/etl_refresh.md`
- `docs/tritongpt_schedule_csv.md`
- `docs/grade_archive.md`
- `docs/course_data_store.md`
- `docs/worker_catalog.md`
- `docs/adr/0001`–`0005`、`0011`–`0015`、`0024`、`0025`、`0029`、`0036`–`0043`
- `docs/planning/archive/tss-webreg-transition-links-2026-07-18.md`

### `05-pipeline-and-schema/`

与课程数据采集、转换、验证、发布和存储直接相关的当前代码与配置，包括：

- UCSD Schedule of Classes / General Catalog / Grade Archive 解析器。
- Class Planner API 获取和 TSS 格式转换。
- Published Snapshot、Import Manifest 和 Supported Term 管线。
- ETL refresh 与定时刷新逻辑。
- Course Data Store 数据库迁移、Hasura metadata、导入器和测试 fixtures。
- API Catalog 路由、R2 Catalog Store、Term Archive Publisher。
- 共享 payload 和 meeting-day schema。

## 数据边界与缺失项

“完整”在这里指：当前仓库和其保存的本地课程数据档案，加上项目实际使用/讨论的公开来源链接。以下内容没有伪装成已包含：

- 私有 Cloudflare R2 中按摘要保存的不可变历史对象没有下载；包内包含当前 Git Published Snapshots、Import Manifests 和本地历史源数据。
- 需要个人 TSS/WebReg 登录权限的页面、Cookie 或个人选课数据没有收集。
- App DB 的用户、登录、Saved Search、Saved Worksheet 数据不属于公开课程数据，没有打包。
- `data/private/` 在整理时为空。
- 网站和 UCSD 来源会继续更新；本包的时间边界固定为上面的 commit 和生成时间。

## 快速查询示例

在资料包根目录运行：

```bash
# 看 FA26 第一门课
jq '.courses[0]' \
  01-current-published-data/api/static/catalogs/public/FA26.json

# 查 FA26 的 CSE:100
jq '.courses[] | select(.course_id == "CSE:100")' \
  01-current-published-data/api/static/catalogs/public/FA26.json

# 只列课程编号、标题和 URL
jq -r '.courses[] | [.course_id, .title, .catalog_url] | @tsv' \
  01-current-published-data/api/static/catalogs/public/FA26.json

# 重新生成清单
node 00-index/build-inventory.mjs
```

## 隐私与安全检查

资料包没有复制 `.env`、`.dev.vars`、私钥、证书、账号 Cookie 或个人数据库。管线 Compose 文件中出现的密码/Secret 字段是环境变量引用，不是导出的凭据。课程和 Section 数据包含 UCSD 公开来源中的教师姓名、上课时间、地点和历史汇总成绩信息，使用时仍应保留来源与时间标签。
