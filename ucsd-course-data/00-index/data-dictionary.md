# Published Snapshot 数据字典

本说明对应 `01-current-published-data/api/static/catalogs/public/*.json` 和匹配的 `import-manifests/*.json`。

`01-current-published-data/live-production-api-2026-08-15/public/*.json` 是不含 `grade_archive_records` 大数组的线上 list 表示；同名 `details/*.json` 按 `course_id` 提供该数组。两者合并后与仓库 Published Snapshot 完全一致，验证记录见 `package-validation-report.json`。

## 学期代码

- `FAxx`：Fall，例如 `FA26` 是 Fall 2026。
- `WIxx`：Winter。
- `SPxx`：Spring。
- `S1xx`：Summer Session I。
- `S2xx`：Summer Session II。
- `S3xx`：Special Summer Session。

完整标签和日期范围以 `01-current-published-data/api/static/metadata.json` 为准。

## Snapshot 顶层

- `term_label`：面向用户显示的学期名。
- `term_date_range`：该学期开始/结束日期。
- `active_planning_term`：生成时的主要规划学期。
- `generated_at`：快照生成时间，也是判断座位信息新鲜度的关键时间。
- `run_id`：生成运行的可追溯标识。
- `source_timestamps`：各来源观察时间；不存在可靠统一时间时可以是 `null`。
- `configured_subjects`：该次运行预期覆盖的 Subject 集合。
- `coverage`：来源覆盖与完整性信息。
- `courses`：课程数组。

## Course

- `course_id`：稳定课程标识，格式通常为 `SUBJECT:NUMBER`，例如 `CSE:100`。
- `subject` / `course_number`：学科代码和课程号。
- `display_course_code`：面向 UI 的课程代码。
- `title` / `units`：课程标题和学分文本。
- `description`：UCSD General Catalog 描述；没有可靠官方匹配时不会猜测补全。
- `prerequisites_text` / `restrictions_text`：先修课与限制原文。
- `catalog_url`：匹配到的 UCSD 官方 Catalog 链接。
- `archive_avg_gpa` / `archive_record_count`：Instructor Grade Archive 汇总指标。
- `grade_archive_records`：保留来源学期、教师、GPA、成绩分布、raw 数据和匹配方式的历史记录。
- `ge_matches`：匹配到的通识教育要求。
- `sections`：该学期可展示/规划的 Section 或 TSS booking package。

## Section

- `section_id`：学期范围内的稳定 Section/package 标识；Saved Worksheet 依赖它保持连续性。
- `section_code`：来源系统显示的 Section code 或重建后的 package code。
- `meeting_type`：Lecture、Discussion、Lab、Final 等类型的规范代码。
- `instructors`：标准化但保留来源语义的教师名数组。
- `meetings`：有顺序的会议/考试时间数组。
- `enrolled` / `capacity` / `waitlist_count`：快照时刻数据，不是实时 WebReg/TSS 数据。
- `available_seats`：来源直接报告的可用座位；TSS/Class Planner 路径不一定能推导 `enrolled`。
- `capacity_kind`：容量是否为有限、无上限/哨兵值或未知。
- `availability_timestamp` / `availability_verified`：座位观察时间与验证状态。
- `raw`：来源名、来源 URL、抓取时间和原始标识等追溯字段。

## Meeting

- `days`：规范化星期数组。
- `date`：单日事件日期（常用于考试）。
- `start_time` / `end_time`：时间；未知时为 `null`。
- `building` / `room`：地点；未知时为 `null`。
- `is_tba`：是否明确为 TBA。
- `meeting_type`：此 Meeting 的类型。
- `raw_days` / `raw_time` / `raw_location`：未经猜测的来源文本。

## Import Manifest

每个学期快照都有同名 Manifest：

- `generated_at` / `run_id` / `term_label`：必须和 Snapshot 对齐。
- `summary`：`ok`、`empty`、`failed`、`partial` 单元计数。
- `cells`：通常按学期、Subject、来源拆分的审计单元。
- `cells[].source`：`schedule_of_classes`、`general_catalog`、`instructor_grade_archive` 等。
- `cells[].status`：该单元的明确完成状态。
- `cells[].reason` / `attempts` / `row_counts`：失败或空结果解释、尝试次数和行数。
- `cells[].raw_artifacts` / `normalized_artifact`：精确指回 `02-complete-local-data-history/data/` 下的来源或标准化文件。

不要只看 Snapshot 是否存在来判断数据完整；应同时查看对应 Manifest 的失败/空/部分单元和来源时间。
