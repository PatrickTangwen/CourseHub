# CourseHub 换皮 Spec:从多 Agent 客服到 UCSD 课程问答助手

| | |
|---|---|
| 状态 | 已达成共识,待实施 |
| 日期 | 2026-08-15 |
| 来源 | grilling 设计会话(18 项决策,见附录 A) |
| 关联 | [CONTEXT.md](../../CONTEXT.md) · [CONTEXT-MAP.md](../../CONTEXT-MAP.md) · [ADR-0001 混合检索](../adr/0001-hybrid-retrieval.md) |

## 1. 背景与目标

把 EchoMind(面向复杂客服任务的多 Agent 客服系统,Python/FastAPI,位于 `EchoMind/`)换皮为 **CourseHub**——回答 UCSD 课程问答的多 Agent 助手,知识源为 SunGrid 发布的课程目录快照(`ucsd-course-data/`)。

- **定位**:作品集项目。重点是展示多 Agent 架构能力,数据够真实即可。
- **语言**:双语自适应——用户用中文答中文,用英文答英文。
- **范围**:仅后端。`EchoMindFrontend/` 本次不动。
- **改动预算**:内容 + 领域常量随便换;允许小的结构性扩展(新增 MCP 工具、`add_documents` 加 metadata 参数);主链路形状(意图 → 路由 → 检索拼上下文 → 生成)不动。

## 2. 不变项(框架层)

以下机制原样保留,零逻辑改动:

- FastAPI 主链路与全部接口形状(`/chat` `/search` `/knowledge/*` `/skills` `/monitor` `/metrics` `/eval/run`)
- 三层记忆:Redis 工作记忆 + ChromaDB `episodic` / `user_profile`(压缩阈值、TTL、异步画像更新)
- 意图三路融合机制(LLM / embedding / pattern;注:当前 `.env` 用 DeepSeek 兼容接口,embedding 路被代码自动关闭,实际两路融合——见 §11)
- AgentOrchestrator 的领域打分、主/辅 Agent 并行、降级、水平扩容槽位
- Skills 热加载机制(front-matter、关键词匹配、prompt 预算)
- 检索优化链(LLM 查询改写 → 并行召回 → 去重 → LLM 重排)
- MCP tool_manager(JSON-Schema 校验、TTL 缓存、三态熔断、降级钩子、统计)
- 监控(Z-score 异常检测、Prometheus、routing penalty 回写)与评测框架(意图准确率/Macro-F1、LLM-as-Judge 四维、回归检测)
- Docker 五件套(app / Redis / ChromaDB / Prometheus / Nginx)

## 3. 领域模型

术语的权威定义在 [CONTEXT.md](../../CONTEXT.md),此处为实施视角摘要。

### 3.1 Agent(枚举值改名:`general` / `course` / `planning`)

| Agent | 职责 | 口径 |
|---|---|---|
| **General Agent** | 首轮接待、问候、能力/元信息问题、意图不明时澄清 | 澄清话术按"课程内容 / 时间名额 / 成绩历史 / 选课规划"四分流 |
| **Course Agent** | 课程事实:内容、先修、时间地点、名额、授课教授、成绩历史 | 严格数据派,受 §7 回答安全约束 |
| **Planning Agent** | 规划建议:选课顺序、负担评估、教授选择 | 可给倾向性建议,每次带规划免责声明,建议必须引用依据 |

**升级语义**:`escalated=true` 从"转人工客服"变为 **Advisor Referral(转介官方渠道)**——enrollment hold、prereq waiver、petition、成绩申诉、accommodations 等个案事务,统一转介 VAC / 院系 advisor / WebReg 支持。**数据查不到不算升级**,如实说数据未覆盖即可。紧急度关键词换为 deadline 类("明天截止"、"last day to drop")。

### 3.2 意图表(14 个细粒度意图 → 5 个意图组)

| 意图组 | 细粒度意图 | 路由 |
|---|---|---|
| `facts` | `course_overview` `prerequisites` `schedule` `availability` `instructor_lookup` `grades_history` `course_search` | Course Agent |
| `planning` | `plan_sequence` `workload_advice` `professor_choice` | Planning Agent |
| `general` | `greeting` `meta_info` | General Agent |
| `escalation` | `advisor_referral` | 转介路径 |
| `other` | `other` | General Agent + 澄清 |

每个意图配中英双语 few-shot 模板和关键词 pattern(两路融合下 pattern 占 15% 权重,质量必须保证)。

### 3.3 实体(替换 order_id / amount / error_code)

| 实体 | 抽取方式 |
|---|---|
| `course_code` | 正则 + 归一化("cse100" / "CSE-100" / "cse 100" → "CSE 100") |
| `term` | 学期代码(FA26/WI25/…)+ 自然语言映射("Fall 2026"、"2026 秋");相对表述("下学期")默认 Active Planning Term(FA26) |
| `subject` | 174 个科目代码词典 |
| `instructor` | 预处理导出的全量教授名单词典匹配(约 5,000 字符串),"Professor X / X 教授" 模式兜底 |
| `units` | 数字 + units/学分 |

实体同时是路由加分项和 `course_lookup` 工具的触发器。

## 4. 检索设计(混合检索,ADR-0001)

### 4.1 语义侧:Knowledge Doc

- **粒度**:每门唯一课程(subject + number)一篇,非每学期一篇。去重后估计 4–6 千篇(脚本给出准确数)。
- **内容**:取最新开课学期的 description / 先修文本 / 限制文本 / 学分 / GE,加一行"开课学期:FA24 … FA26"。
- **metadata**:`{subject, course_number, terms_offered}`(需给 `add_documents` 加可选 metadata 参数,ChromaDB 原生支持)。
- **渲染**:短文本 + 换行分隔字段,规避 chunker 按中文句号切块对英文文本失效的问题。

### 4.2 结构化侧:Course Index + `course_lookup` 工具

- **Course Index**:预处理脚本把 15 个学期快照压成一个 SQLite(≈20MB):`courses` / `sections` / `grade_records` 三张表。派生产物,快照更新时重建,不手改。
- **`course_lookup` 工具**:注册进现有 MCP tool_manager(自动获得熔断/缓存/监控)。支持按 (course_code, term) 查 sections/时间/名额/教授,按 instructor 查开课与成绩记录,按条件筛课(学分、科目、学期)。
- **触发**:在拼知识上下文一步(`_build_knowledge_context`),实体命中 `course_code` 或 `instructor` 时与语义检索并行调用,两路结果一起拼进上下文。主链路形状不变。
- **铁律**:精确数字(名额、时间、GPA)只来自 Course Index 结果,绝不靠生成。

### 4.3 数据源

唯一 canonical 源:`ucsd-course-data/01-current-published-data/api/static/catalogs/public/*.json`(15 学期,246MB,与生产环境深度校验一致)。规模:19,041 门课次、61,496 sections、165,447 meetings、15,138 条成绩记录(仅 FA26)。

## 5. 内容替换清单(文件级)

| 文件 | 改动 |
|---|---|
| `core/intent_recognizer.py` | 意图枚举、意图组映射、few-shot 模板、关键词表、实体正则/词典、紧急度关键词,全部换为 §3.2/§3.3;意图识别 prompt 从"客服意图分析专家"改为课程问答表述 |
| `agents/agent_orchestrator.py` | `AgentType` 枚举改名、三个 persona prompt、`_INTENT_ROUTING` 表、领域打分关键词表(含 `_collaboration_targets` 里的重复副本)、澄清话术、升级关键词表 |
| `api/main.py` | RAG 触发意图白名单与 business_keywords、知识上下文 footer、course_lookup 并行触发、banner/FastAPI title 品牌 |
| `mcp/knowledge_base.py` | `_load_default_docs()` 换为 CourseHub 元文档(数据覆盖说明、能力边界、如何读成绩数据等);`add_documents` 加 metadata 参数 |
| `skills/` | 三份 SKILL.md 重写:`general_reception` / `course_facts` / `course_planning`(要点见 §7),front-matter `agents:` 用新枚举名,关键词中英双语 |
| `evaluation/evaluator.py` | Judge prompt 改为课程问答质量评估;`DEFAULT_INTENT_CASES` / `DEFAULT_DIALOG_CASES` 换为 §8 用例 |
| `memory/conversation_memory.py` | 画像抽取 schema keys:`{"产品","问题类型"}` → `{"课程","科目","学期","问题类型"}` |
| `mcp/tool_manager.py` | 仅查询改写 docstring 里的客服示例措辞 |
| `data/chroma/` | 删除已提交的旧客服索引(sqlite + HNSW 段),并修 `.gitignore` 使 `data/` 真正生效 |
| `data/eval/baseline.json` | 删除(旧客服基线,且已与用例集脱节),新用例首跑重建 |
| `data/demo_docs/` | 客服演示文档换为课程域示例 |
| `docker-compose.yml`、`Dockerfile`、`*.sh`、`.env`、`README.md` | 品牌 EchoMind → CourseHub(容器/镜像名、env 前缀、banner);README 定向更新(见 §9) |

## 6. 新增组件

1. **预处理脚本**(独立目录,不进后端框架;建议 `EchoMind/tools/build_course_data.py`):读 15 个快照 JSON,产出 ① Knowledge Docs(经 `/knowledge/add` 或直调 KB 灌库)② Course Index SQLite ③ 教授名单词典 ④ 科目代码词典。
2. **`course_lookup` 工具**(见 §4.2)。
3. **`add_documents` metadata 参数**(见 §4.1)。

## 7. 回答安全约束(继承自 SunGrid 领域文档,写死进 SKILL.md)

1. **名额/座位数字必须带快照时间戳**(数据为 2026-08-12/13 静态快照),绝不能表述为实时。
2. **禁止合成单一课程 GPA**(SunGrid ADR-0014):成绩历史按 教授 × 学期 列出。
3. **缺 description 不编造**(约 20% 课程无官方描述,明说"官方目录无描述")。
4. **数据缺口如实声明**:无 CAPE/SET 教评;成绩记录仅 FA26 快照携带;非 FA26 学期名额覆盖约 60%。
5. **Planning Disclaimer**:Planning Agent 每次建议附"非官方 advising 建议,选课决策请咨询 advisor";成绩数据禁止外推为"总是如此"。

## 8. 评测

- **意图用例(14 条,中英混合)**:"CSE 100 讲什么?"→course_overview;"What are the prerequisites for CSE 101?"→prerequisites;"FA26 的 MATH 20C 什么时候上课?"→schedule;"Is there space left in CSE 100?"→availability;"谁教 CSE 100?"→instructor_lookup;"CSE 100 历年 GPA 怎么样?"→grades_history;"FA26 有哪些 4 学分的 CSE 课?"→course_search;"我该先修 CSE 100 还是 CSE 101?"→plan_sequence;"同时上 CSE 100 和 CSE 110 会不会太累?"→workload_advice;"选 Kane 还是 Sahoo 的 section?"→professor_choice;"你好"→greeting;"你的数据是什么时候更新的?"→meta_info;"我的 enrollment hold 怎么解除?"→advisor_referral;"今天天气怎么样"→other。
- **对话用例(5 条,各针对一条安全约束)**:① 多轮 ["我想了解 CSE 100","它的先修是什么?","FA26 谁教?"](记忆+实体延续);② "CSE 100 还有位置吗?"(时间戳);③ "CSE 100 的平均 GPA 是多少?"(ADR-0014 表述);④ "帮我规划大二秋季的课"(免责声明);⑤ "我 prereq 被卡了怎么办"(转介)。
- 通过阈值维持 0.75;基线删除后首跑重建。

## 9. 品牌与文档

- 全部可见面 EchoMind → **CourseHub**:banner、FastAPI title、容器/镜像名、脚本内 IMAGE_NAME、env 前缀(`ECHOMIND_*` → `COURSEHUB_*`,compose 与代码同步改)。
- `README.md`(1392 行)定向更新:品牌、架构描述、示例请求/响应、知识库与工具章节换课程域;部署/排障章节仅改名。`wiki/` 与使用指南 PDF 不动。

## 10. 顺手修复

- `.env` 中 `ANTHROPIC_MODEL= deepseek-v4-flash` 的前导空格。
- 已提交的 `data/chroma/` 旧索引清理 + `.gitignore` 修正(§5)。

## 11. 已知限制与风险

| 事项 | 说明 |
|---|---|
| 两路意图融合 | DeepSeek 兼容接口下 embedding 路自动关闭(LLM 85% + pattern 15%),意图准确率预期略低于三路;关键词表质量是主要补偿手段 |
| 数据是静态快照 | generated_at 2026-08-13;所有"名额"均为历史快照值 |
| 成绩数据偏科 | 15,138 条记录全部挂在 FA26 快照;professor_choice 类建议的证据面窄 |
| Section 结构异构 | FA26 为 TSS "Package" 结构,其余 14 学期为 Schedule of Classes 结构;meeting_type 词汇未归一——Course Index 建表时归一化 |
| 众包成绩 CSV | `Grades_With_Cutoff.csv`(12,346 行)留二期:格式脏(学期/课号写法不一致、分布为未解析字符串),且主观"推荐教授"数据需单独设计可信度边界 |

## 12. 验收标准

1. §8 的 5 条对话用例经 `/chat` 全部路由正确,回复满足对应安全约束。
2. `POST /eval/run` pass_rate ≥ 0.75,新基线落盘。
3. `/knowledge/stats` 显示约 4–6 千篇文档;`/search` 对课程语义查询返回相关结果。
4. `course_lookup` 出现在 `/monitor` 的 tool_stats 中,熔断状态 closed。
5. `/chat` 响应中 `agent_type` ∈ {general, course, planning};API 表面无任何 EchoMind/客服残留字符串。
6. 中文问题得中文回答,英文问题得英文回答。

## 13. 二期展望(明确不做)

前端换皮、众包成绩 CSV 接入、CAPE/SET(上游即无)、实时名额(上游明确排除)。

---

## 附录 A:决策记录(grilling 会话,2026-08-15)

| # | 决策点 | 结论 |
|---|---|---|
| Q1 | 目的 | C:作品集项目 |
| Q2 | 改动边界 | C:内容+领域常量+小结构扩展,主链路不动 |
| Q3 | 语言 | C:双语自适应 |
| Q4 | 范围/命名 | A:仅后端;命名 CourseHub |
| Q5 | Agent 切法 | A:按问题类型(通用/事实/规划) |
| Q6 | 数据范围 | C:15 学期全灌 + term metadata,偏向最新 |
| Q7 | 众包 CSV | C:留二期 |
| Q8 | 意图表 | 14 意图 / 5 组,照案通过 |
| Q9 | 实体 | 5 种,照案通过 |
| Q10 | 结构化工具 | B:SQLite Course Index + course_lookup |
| Q11 | 升级语义 | Advisor Referral(转介官方渠道) |
| Q12 | 枚举命名 | A:改为 general/course/planning |
| Q13 | 建议口径 | B:免责声明建议派 |
| Q14 | RAG 粒度 | B:每门唯一课程一篇 |
| Q15 | 评测用例 | 照案通过 |
| Q16 | SKILL.md 要点 | 照案通过 |
| Q17 | 文档深度 | B:README 定向更新 |
| Q18 | ADR | 写:ADR-0001 混合检索 |
