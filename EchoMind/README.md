# CourseHub 完整使用指南

本文档说明 CourseHub 的部署、启动、API 调用、知识库使用、ChromaDB 数据查看、监控评测和常见排障。

CourseHub 是一个回答 UCSD 课程问题的双语多 Agent 问答助手，核心链路为：

```text
用户请求
  -> FastAPI /chat
  -> MemoryManager 读取 Redis 工作记忆 + ChromaDB 情景记忆 + 用户画像
  -> IntentRecognizer 识别意图与实体（course_code/term/subject/instructor/units）
  -> 混合检索拼上下文（ADR-0001）：ChromaDB 语义检索 + course_lookup 查询 Course Index
  -> AgentOrchestrator 路由到 General/Course/Planning Agent
  -> LLM 生成回复
  -> 写入 Redis，并异步更新 ChromaDB 用户画像
```

三个 Agent 的分工：General Agent 负责接待、需求澄清和元信息问题；Course Agent 负责课程事实（内容、先修、时间地点、名额、授课教授、成绩历史），严格依据目录数据；Planning Agent 负责选课规划建议（选课顺序、负担评估、教授选择），每次建议附免责声明。升级语义为 **Advisor Referral**：`escalated=true` 表示"已转介官方渠道"（VAC / 院系 advisor / WebReg 支持），不是转人工客服。用户用中文提问答中文，用英文提问答英文。

数据来自 SunGrid 发布的 UCSD 课程目录静态快照（FA24–FA26 共 15 个学期，19,041 门课次、61,496 个 section、15,138 条成绩记录，快照生成于 2026-08-13），非实时数据。

## 1. 项目结构

```text
EchoMind/  # 仓库中的后端目录名
├── api/main.py                    # FastAPI 入口，/chat /search /knowledge /monitor /eval
├── core/intent_recognizer.py      # 三路融合意图识别
├── agents/agent_orchestrator.py   # 多 Agent 路由编排
├── memory/conversation_memory.py  # Redis + ChromaDB 记忆管理
├── mcp/tool_manager.py            # MCP 工具调用、查询改写、重排、熔断、缓存、降级
├── mcp/knowledge_base.py          # ChromaDB RAG 知识库
├── mcp/course_lookup.py           # course_lookup 工具：查询 SQLite Course Index
├── monitor/performance_monitor.py # Agent/工具在线监控
├── evaluation/evaluator.py        # 端到端评测
├── tools/build_course_data.py     # 从课程快照构建 Course Index / Knowledge Docs / 词典
├── tools/ingest_knowledge_docs.py # 把 Knowledge Docs 批量灌入知识库
├── data/coursehub/                # course_index.sqlite、knowledge_docs.json、dictionaries.json
├── data/demo_docs/                # 演示知识库文档
├── docker-compose.yml             # Docker 全栈编排
├── Dockerfile
├── requirements.txt
├── requirements-dev.txt           # 本地测试依赖（含 pytest）
└── .env
```

## 2. 环境准备

### 2.1 必需依赖

- Docker
- Docker Compose
- Anthropic API Key，或兼容 Anthropic 协议的第三方 API Key

本地运行确定性测试时安装开发依赖：

```bash
python -m pip install -r requirements-dev.txt
python -m pytest tests -q
```

### 2.2 配置 `.env`

复制示例文件：

```bash
cp .env.example .env
```

最少需要配置：

```env
ANTHROPIC_API_KEY=your_api_key
```

如果使用 DeepSeek 这类 Anthropic 兼容接口，可以配置：

```env
ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
ANTHROPIC_MODEL=deepseek-v4-pro
ANTHROPIC_API_KEY=your_deepseek_key
```

Docker Compose 场景下，Redis 和 ChromaDB 的连接由 `docker-compose.yml` 覆盖为容器内地址。通常不需要手动改：

```env
REDIS_PASSWORD=coursehub123
CHROMA_HOST=localhost
CHROMA_PORT=8001
```

课程快照和派生产物路径可以通过环境变量覆盖：

```env
COURSEHUB_DATA_DIR=./data/coursehub
COURSEHUB_SNAPSHOTS_DIR=../ucsd-course-data/01-current-published-data/api/static/catalogs/public
```

启动时会校验 SQLite schema、快照新鲜度以及 Knowledge Docs/词典是否齐全；缺失或过期时自动从快照重建。

### 2.3 全栈部署和 run 开发模式的区别

CourseHub 常用两种 Docker 启动方式：`docker compose up` 全栈部署，以及 `docker run` 开发模式。两者最大的区别是：**全栈部署会同时启动应用和依赖服务；run 开发模式通常只手动运行一个应用容器，依赖服务需要提前启动**。

| 对比项 | Docker Compose 全栈部署 | Docker run 开发模式 |
|--------|--------------------------|----------------------|
| 启动命令 | `docker compose up -d --build` | `docker run ... coursehub ...` |
| 启动内容 | CourseHub 应用、Redis、ChromaDB、Prometheus、Nginx | 只启动你指定的单个容器 |
| Redis/ChromaDB | 自动启动并加入同一网络 | 必须先执行 `docker compose up -d redis chromadb` |
| 容器网络 | Compose 自动创建并管理 | 需要手动指定 `--network coursehub-network` |
| 服务名解析 | 应用可直接访问 `redis`、`chromadb` | 只有加入同一网络后才可访问 `redis`、`chromadb` |
| 代码更新 | 通常需要 rebuild 或重启服务 | 挂载 `-v "$(pwd):/workspace"` 后，代码修改可直接生效，重启容器即可 |
| 适合场景 | 演示、联调、完整部署、HTTP API 服务 | 本地开发、调试 CLI、临时覆盖环境变量 |
| 常见问题 | API Key 或依赖健康检查失败 | 忘记启动 Redis/ChromaDB，导致 `redis:6379 Name or service not known` |

选择建议：

- 想完整体验 HTTP API、Swagger、Nginx、Prometheus：用 **Docker Compose 全栈部署**。
- 想调试源码或 CLI，并且希望本地改代码后快速重跑：用 **Docker run 开发模式**。
- 如果只是跑 CLI，最省心的方式是 `docker compose run --rm coursehub python api/main.py --cli`，它会自动使用 Compose 网络。

## 3. Docker Compose 全栈部署

推荐使用此方式启动完整服务。

```bash
docker compose up -d --build
```

查看服务状态：

```bash
docker compose ps
```

查看应用日志：

```bash
docker compose logs -f coursehub
```

看到 CourseHub 启动日志并且健康检查通过后，服务可用。

启动后的端口：

| 服务 | 容器名 | 宿主机端口 | 容器内端口 | 用途 |
|------|--------|------------|------------|------|
| CourseHub API | `coursehub-app` | `8000` | `8000` | 主 API 服务 |
| Nginx | `coursehub-nginx` | `80` | `80` | 反向代理 |
| ChromaDB | `coursehub-chromadb` | `8001` | `8000` | 向量数据库 |
| Redis | `coursehub-redis` | `6379` | `6379` | 工作记忆 |
| Prometheus | `coursehub-prometheus` | `9090` | `9090` | 监控数据 |

API 的宿主机端口由 `.env` 中的 `COURSEHUB_HOST_PORT` 控制（`.env.example` 默认 8000）。本文示例统一按 8000 书写，端口不同时请自行替换。

健康检查：

```bash
curl http://localhost:8000/health
```

Swagger 文档：

```text
http://localhost:8000/docs
```

也可以通过 Nginx 访问：

```bash
curl http://localhost/health
```

## 4. Docker Run 开发模式

开发时可以只用 Compose 启动依赖，然后用 `docker run` 挂载当前代码目录。

先启动 Redis 和 ChromaDB：

```bash
docker compose up -d redis chromadb
```

构建镜像：

```bash
docker compose build --no-cache coursehub
```

启动 HTTP 服务：

```bash
docker run -it --rm \
  --network coursehub-network \
  -p 8000:8000 \
  -e ANTHROPIC_BASE_URL="https://api.deepseek.com/anthropic" \
  -e ANTHROPIC_API_KEY="your_key" \
  -e ANTHROPIC_MODEL="deepseek-v4-pro" \
  -e REDIS_URL="redis://:coursehub123@redis:6379/0" \
  -e CHROMA_HOST="chromadb" \
  -e CHROMA_PORT="8000" \
  -e CHROMA_PERSIST_DIRECTORY="/workspace/data/chroma" \
  -e COURSEHUB_SNAPSHOTS_DIR="/course-data" \
  -v "$(pwd)/../ucsd-course-data/01-current-published-data/api/static/catalogs/public:/course-data:ro" \
  -v "$(pwd):/workspace" \
  -w /workspace \
  coursehub
```

CLI 交互模式：

```bash
docker run -it --rm \
  --network coursehub-network \
  -e ANTHROPIC_BASE_URL="https://api.deepseek.com/anthropic" \
  -e ANTHROPIC_API_KEY="your_key" \
  -e ANTHROPIC_MODEL="deepseek-v4-pro" \
  -e REDIS_URL="redis://:coursehub123@redis:6379/0" \
  -e CHROMA_HOST="chromadb" \
  -e CHROMA_PORT="8000" \
  -e COURSEHUB_SNAPSHOTS_DIR="/course-data" \
  -v "$(pwd)/../ucsd-course-data/01-current-published-data/api/static/catalogs/public:/course-data:ro" \
  -v "$(pwd):/workspace" \
  -w /workspace \
  coursehub \
  python api/main.py --cli
```

## 5. Swagger 和接口总览

CourseHub 基于 FastAPI 构建，启动 HTTP 服务后可以直接在浏览器访问 Swagger UI 调用接口。

本地 Swagger 地址：

```text
http://localhost:8000/docs
```

如果使用 Nginx 反向代理：

```text
http://localhost/docs
```

打开 Swagger 后，可以点击任意接口右侧的 **Try it out**，填写参数后点 **Execute** 直接调用本地服务。常用调试顺序：

```text
1. GET /health                确认服务是否就绪
2. POST /chat                 测试主对话链路
3. GET /knowledge/stats       查看知识库是否已有数据
4. POST /knowledge/upload     上传演示知识库文件
5. POST /search               测试知识库检索、查询改写和重排
6. GET /monitor               查看 Agent 和工具运行指标
7. GET /skills                查看已加载 Skills
8. POST /skills/reload        重新加载 Skills
9. POST /eval/run             运行端到端评测
```

### 5.1 接口总览

| 方法 | 路径 | 参数位置 | 作用 | 适合场景 |
|------|------|----------|------|----------|
| `GET` | `/health` | 无 | 健康检查，返回服务状态和 Agent 统计 | 启动后确认服务可用 |
| `POST` | `/chat` | JSON Body | 主对话接口，完成记忆读取、意图识别、Agent 路由、回复生成、记忆写入 | 问答主链路 |
| `GET` | `/monitor` | 无 | 查看 Agent/工具统计、告警和优化建议 | 观察在线表现 |
| `POST` | `/search` | Query 参数 | 执行知识库检索优化链路：查询改写、并行召回、合并去重、LLM 重排 | 测试 RAG 检索 |
| `GET` | `/skills` | 无 | 查看当前加载的 Skills、匹配关键词和解析错误 | 确认动态能力是否生效 |
| `POST` | `/skills/reload` | 无 | 运行时重新扫描 Skill 目录 | 修改回答规范后热加载 |
| `POST` | `/knowledge/add` | JSON Body | 批量导入文档到 ChromaDB 知识库 | 程序化导入文档 |
| `POST` | `/knowledge/upload` | Form File | 上传 `.txt`、`.md`、`.json` 文件导入知识库 | 手动上传知识库文件 |
| `GET` | `/knowledge/stats` | 无 | 查看总片段、总文档和课程文档数 | 确认课程知识库是否就绪 |
| `POST` | `/eval/run` | 无 | 运行内置意图识别和端到端对话评测 | 演示 LLM-as-Judge 评测 |
| `GET` | `/docs` | 浏览器访问 | Swagger UI | 浏览和调试所有接口 |

### 5.2 Skills 动态能力加载

CourseHub 支持从目录加载 Skills，用来把回答规范、回答安全约束、转介规则等动态注入 Agent。

默认配置：

```env
COURSEHUB_SKILLS_DIR=./skills
COURSEHUB_SKILLS_MAX_PROMPT_CHARS=5000
```

当前内置三类 Skills：

```text
skills/general_reception/SKILL.md  # 接待分流：双语接待、需求澄清、能力边界、个案转介
skills/course_facts/SKILL.md       # 课程事实：客观信息应答与五条回答安全约束
skills/course_planning/SKILL.md    # 规划建议：有依据的倾向性建议与免责声明
```

`SKILL.md` 示例：

```markdown
---
name: 课程事实规范
description: 适用于 Course Agent 的课程客观信息应答规范
keywords: 先修,学分,名额,教授,GPA,schedule,prerequisite
agents: course
enabled: true
---

# 课程事实规范

- 名额、时间等精确数字只引用 Course Index 查询结果，并注明快照时间。
- 个案事务（hold、petition、waiver、申诉）转介官方渠道。
```

查看加载结果：

```bash
curl http://localhost:8000/skills
```

修改 Skill 文件后热加载：

```bash
curl -X POST http://localhost:8000/skills/reload
```

### 5.3 `/health`

用途：确认服务是否初始化完成。

```bash
curl http://localhost:8000/health
```

响应示例：

```json
{
  "status": "ok",
  "agents": {
    "general_0": {
      "total": 0,
      "success_rate": 1.0,
      "avg_ms": 0.0,
      "monitor_penalty": 0.0,
      "routing_score": 1.0
    }
  }
}
```

### 5.4 `/chat`

用途：主对话接口。

请求体：

```json
{
  "message": "谁教 CSE 100？",
  "user_id": "user_001",
  "conv_id": "session_001"
}
```

字段说明：

| 字段 | 必填 | 说明 |
|------|------|------|
| `message` | 是 | 用户输入 |
| `user_id` | 否 | 用户 ID，默认 `anonymous` |
| `conv_id` | 否 | 会话 ID，不传则自动生成 |

返回字段：

| 字段 | 说明 |
|------|------|
| `conv_id` | 会话 ID |
| `response` | Agent 回复 |
| `intent` | 细粒度意图，14 种之一（如 `availability`、`instructor_lookup`） |
| `intent_group` | 意图组：`facts` / `planning` / `general` / `escalation` / `other` |
| `agent_type` | 实际处理请求的 Agent：`general` / `course` / `planning` |
| `agent_types` | 参与本次请求的全部 Agent |
| `primary_agent` / `supporting_agents` | 多 Agent 协作时的主 Agent 与辅助 Agent |
| `routing_reason` / `routing_confidence` | 路由依据与置信度 |
| `escalated` | 是否已转介官方渠道（Advisor Referral） |
| `latency_ms` | 端到端耗时 |
| `knowledge_used` | 本次回复是否用到了检索结果 |
| `entities` | 抽取的实体：`course_code` / `term` / `subject` / `instructor` / `units` |
| `intent_confidence` / `intent_source_scores` | 意图置信度与各识别路（llm/pattern 等）得分 |

### 5.5 `/search`

用途：测试 MCP 工具调用和 RAG 检索优化。

Query 参数：

| 参数 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `query` | 是 | 无 | 用户检索问题 |
| `top_k` | 否 | `5` | 返回结果数量 |

示例：

```bash
curl -X POST "http://localhost:8000/search?query=数据结构课程&top_k=3"
```

### 5.6 `/knowledge/add`

用途：通过 JSON 批量导入知识库。

请求体：

```json
{
  "documents": [
    {
      "title": "CSE 100: Advanced Data Structures",
      "content": "课程内容：高级数据结构与相关算法...\n学分：4\n先修：CSE 21 或 MATH 154...\n开课学期：FA24 ... FA26",
      "metadata": {"subject": "CSE", "course_number": "100"}
    }
  ]
}
```

`metadata` 为可选字段，键值（标量）会并入每个片段的 ChromaDB metadata，课程文档用它携带 `subject` / `course_number` / `terms_offered`。

### 5.7 `/knowledge/upload`

用途：上传文件导入知识库。

支持格式：

| 格式 | 说明 |
|------|------|
| `.txt` | 整个文件作为一篇文档 |
| `.md` | 整个文件作为一篇文档 |
| `.json` | JSON 数组，格式为 `[{ "title": "...", "content": "..." }]` |

示例：

```bash
curl -X POST http://localhost:8000/knowledge/upload \
  -F "file=@data/demo_docs/sample_knowledge.json"
```

### 5.8 `/knowledge/stats`

用途：查看知识库片段数量。

```bash
curl http://localhost:8000/knowledge/stats
```

### 5.9 `/monitor`

用途：查看 Agent 和工具在线指标。

```bash
curl http://localhost:8000/monitor
```

返回内容包括：

| 字段 | 说明 |
|------|------|
| `agent_stats` | Agent 调用次数、成功率、延迟、routing_score |
| `tool_stats` | 工具调用次数、成功率、延迟、熔断状态 |
| `active_alerts` | 最近告警 |
| `suggestions` | 优化建议 |

### 5.10 `/eval/run`

用途：运行内置评测。

```bash
curl -X POST http://localhost:8000/eval/run
```

返回内容包括：

| 字段 | 说明 |
|------|------|
| `pass_rate` | 评测通过率 |
| `total` | 评测项总数 |
| `passed` | 通过项数量 |
| `avg_scores` | 平均评分 |
| `regressions` | 回归检测结果 |
| `recommendations` | 优化建议 |
| `results` | 每条评测结果 |

## 6. 使用项目

### 6.1 主对话接口

请求：

```bash
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Is there space left in CSE 100?",
    "user_id": "user_001",
    "conv_id": "session_001"
  }'
```

响应示例：

```json
{
  "conv_id": "session_001",
  "response": "As of the 2026-08-12 catalog snapshot, CSE 100 (FA26) shows 100/100 seats taken and 0 available. Seat counts are a static snapshot, not real-time — please check WebReg for current availability.",
  "intent": "availability",
  "intent_group": "facts",
  "agent_type": "course",
  "agent_types": ["course"],
  "primary_agent": "course",
  "supporting_agents": [],
  "routing_reason": "意图 availability 属于 facts 组，路由到 Course Agent",
  "routing_confidence": 0.92,
  "escalated": false,
  "latency_ms": 1234.5,
  "knowledge_used": true,
  "entities": {"course_code": ["CSE 100"]},
  "intent_confidence": 0.91,
  "intent_source_scores": {"llm": 0.9, "pattern": 1.0}
}
```

字段说明：

| 字段 | 含义 |
|------|------|
| `message` | 用户输入（英文提问得英文回答，中文提问得中文回答） |
| `user_id` | 用户唯一标识，用于隔离记忆和用户画像 |
| `conv_id` | 会话 ID，相同 `conv_id` 表示同一轮多轮对话 |
| `intent` / `intent_group` | 细粒度意图及其意图组 |
| `agent_type` | 实际处理请求的 Agent（`general` / `course` / `planning`） |
| `entities` | 抽取出的课程实体，命中 `course_code` / `instructor` 时会触发 `course_lookup` 精确查询 |
| `escalated` | 是否已转介官方渠道（Advisor Referral） |
| `latency_ms` | 端到端延迟 |

注意示例回复中的名额数字带有快照时间戳：这是回答安全约束之一，名额永远按静态快照口径表述，不是实时数据。

### 6.2 多轮对话

多轮对话只需要保持同一个 `user_id` 和 `conv_id`。

```bash
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "它的先修是什么？",
    "user_id": "user_001",
    "conv_id": "session_001"
  }'
```

系统会从 Redis 读取当前会话最近消息，并从 ChromaDB 读取相关历史和用户画像，拼成上下文传给 Agent。上面这句依赖上一轮提到的课程实体（如 CSE 100）延续对话。

### 6.3 课程事实示例

```bash
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "谁教 CSE 100？",
    "user_id": "user_facts",
    "conv_id": "facts_001"
  }'
```

预期识别为 `instructor_lookup` 意图并路由到 `course` Agent，回答引用 Course Index 中 FA26 的授课教授（Paul Cao）。

再试一个时间地点问题：

```bash
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "FA26 的 MATH 20C 什么时候上课？",
    "user_id": "user_facts",
    "conv_id": "facts_002"
  }'
```

预期识别为 `schedule` 意图，回答给出 FA26 快照中的上课安排（如 MWF 8:00–8:50，WLH 2005，instructor Michael Holst），并注明学期。

### 6.4 规划建议示例

```bash
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "同时上 CSE 100 和 CSE 110 会不会太累？",
    "user_id": "user_plan",
    "conv_id": "plan_001"
  }'
```

预期识别为 `workload_advice` 意图并路由到 `planning` Agent。回答会给出有依据的倾向性建议，并附规划免责声明（非官方 advising 建议，选课决策请咨询 advisor）。

### 6.5 复合问题示例

```bash
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "CSE 100 还有位置吗？另外我下学期同时上 CSE 100 和 CSE 110 会不会太累？",
    "user_id": "user_mix",
    "conv_id": "mix_001"
  }'
```

这类问题会触发多 Agent 并行协作，由 Course Agent 和 Planning Agent 分别处理后合并回复（响应中的 `primary_agent` / `supporting_agents` 会体现协作关系）。

## 7. 知识库使用

CourseHub 的知识库由 `mcp/knowledge_base.py` 管理，底层使用 ChromaDB collection：

```text
knowledge_base
```

首次启动时会自动导入 6 篇 CourseHub 元文档（数据来源与覆盖、名额数据使用规则、成绩历史数据的读法、能力边界、学期代码说明、提问技巧），保证 `meta_info` 类问题有据可答。

课程正文数据会在服务启动时自动构建并幂等导入，不需要手工运行数据管线。也可以离线强制重建派生产物：

```bash
# 产出 data/coursehub/{course_index.sqlite, knowledge_docs.json, dictionaries.json}
python tools/build_course_data.py
```

Knowledge Doc 的粒度是每门唯一课程（subject + number）一篇，共 5,968 篇；当前 chunker 生成 8,362 个课程片段，加上 6 篇元文档后共 8,368 个片段。

检索采用混合方案（ADR-0001）：ChromaDB 语义检索负责课程描述类内容；精确数字（名额、时间、GPA）由 `course_lookup` 工具查询 SQLite Course Index，实体命中 `course_code` 或 `instructor` 时与语义检索并行触发，两路结果一起拼进上下文。精确数字只来自 Course Index，绝不靠生成。

### 7.1 查看知识库统计

```bash
curl http://localhost:8000/knowledge/stats
```

响应示例：

```json
{
  "total_chunks": 8368,
  "total_documents": 5974,
  "course_documents": 5968
}
```

`/health` 只有在 `course_lookup` 已注册且 `course_documents > 0` 时才返回 `status=ok`，因此不会把只有元文档的空课程库误报为健康。

### 7.2 批量导入文档

```bash
curl -X POST http://localhost:8000/knowledge/add \
  -H "Content-Type: application/json" \
  -d '{
    "documents": [
      {
        "title": "CSE 100: Advanced Data Structures",
        "content": "课程内容：高级数据结构与相关算法...\n学分：4\n开课学期：FA24 ... FA26",
        "metadata": {"subject": "CSE", "course_number": "100"}
      },
      {
        "title": "选课时间线小贴士",
        "content": "UCSD 每学期按 first pass / second pass 分批开放选课，热门课程建议第一时间注册。"
      }
    ]
  }'
```

系统会把长文档切成 500 字左右的片段，并写入 ChromaDB。`metadata` 为可选字段，键值会并入每个片段的 ChromaDB metadata。

### 7.3 上传文件导入知识库

上传 Markdown：

```bash
curl -X POST http://localhost:8000/knowledge/upload \
  -F "file=@data/demo_docs/troubleshooting.md"
```

上传 JSON：

```bash
curl -X POST http://localhost:8000/knowledge/upload \
  -F "file=@data/demo_docs/sample_knowledge.json"
```

JSON 格式必须是数组：

```json
[
  {
    "title": "文档标题",
    "content": "文档内容"
  }
]
```

### 7.4 检索知识库

```bash
curl -X POST "http://localhost:8000/search?query=数据结构课程&top_k=3"
```

响应示例：

```json
{
  "query": "数据结构课程",
  "results": [
    {
      "title": "CSE 100: Advanced Data Structures",
      "content": "课程内容：高级数据结构与相关算法...\n学分：4\n开课学期：FA24 ... FA26",
      "score": 0.82,
      "chunk": 0
    }
  ],
  "reranked": true
}
```

`/search` 使用的是完整检索优化链路：

```text
原始查询
  -> LLM 查询改写成多个角度
  -> 多个子查询并行召回 ChromaDB
  -> 合并去重
  -> LLM 重排
  -> 返回 Top-K
```

## 8. ChromaDB 在项目中的用途

CourseHub 使用了三个 ChromaDB collection：

| Collection | 模块 | 作用 |
|------------|------|------|
| `knowledge_base` | `mcp/knowledge_base.py` | RAG 知识库文档片段 |
| `episodic` | `memory/conversation_memory.py` | 压缩后的历史对话摘要 |
| `user_profile` | `memory/conversation_memory.py` | 用户画像，包含偏好和关键实体 |

数据写入时机：

| 数据 | 写入时机 |
|------|----------|
| `knowledge_base` | 启动时自动导入默认文档，或调用 `/knowledge/add`、`/knowledge/upload` |
| `episodic` | 当前会话工作记忆超过阈值后自动压缩并写入 |
| `user_profile` | 每次 `/chat` 回复后异步提炼并更新 |

## 9. 在 Docker 中查看 ChromaDB 内容

Compose 中 ChromaDB 容器名是：

```text
coursehub-chromadb
```

宿主机访问端口是：

```text
http://localhost:8001
```

容器内部端口是：

```text
http://localhost:8000
```

### 9.1 查看 ChromaDB 是否存活

宿主机执行：

```bash
curl http://localhost:8001/api/v1/heartbeat
```

容器内执行：

```bash
docker exec -it coursehub-chromadb curl http://localhost:8000/api/v1/heartbeat
```

### 9.2 查看所有 collection

```bash
curl http://localhost:8001/api/v1/collections
```

如果 ChromaDB 版本返回 tenant/database 相关错误，可以使用 Python 客户端查看，见下一节。

### 9.3 用 Python 客户端查看 collections

进入应用容器：

```bash
docker exec -it coursehub-app bash
```

在容器里执行：

```bash
python - <<'PY'
import chromadb

client = chromadb.HttpClient(host="chromadb", port=8000)
print("heartbeat:", client.heartbeat())

collections = client.list_collections()
print("collections:")
for c in collections:
    print("-", c.name, "count=", c.count())
PY
```

预期可以看到：

```text
collections:
- knowledge_base count= ...
- episodic count= ...
- user_profile count= ...
```

### 9.4 查看 `knowledge_base` 文档内容

```bash
docker exec -it coursehub-app bash
```

执行：

```bash
python - <<'PY'
import chromadb

client = chromadb.HttpClient(host="chromadb", port=8000)
col = client.get_collection("knowledge_base")

data = col.get(limit=10, include=["documents", "metadatas"])
for i, doc_id in enumerate(data["ids"]):
    print("=" * 80)
    print("id:", doc_id)
    print("metadata:", data["metadatas"][i])
    print("document:", data["documents"][i][:500])
PY
```

### 9.5 查询 `knowledge_base`

```bash
docker exec -it coursehub-app bash
```

执行：

```bash
python - <<'PY'
import chromadb

client = chromadb.HttpClient(host="chromadb", port=8000)
col = client.get_collection("knowledge_base")

result = col.query(
    query_texts=["数据结构课程"],
    n_results=3,
    include=["documents", "metadatas", "distances"],
)

for doc, meta, dist in zip(
    result["documents"][0],
    result["metadatas"][0],
    result["distances"][0],
):
    print("=" * 80)
    print("title:", meta.get("title"))
    print("distance:", dist)
    print("content:", doc[:300])
PY
```

### 9.6 查看用户画像 `user_profile`

先多调用几次 `/chat`，让系统异步生成用户画像：

```bash
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "我主要关注 CSE 和 MATH 的课程，回答请简洁一点", "user_id": "profile_user", "conv_id": "profile_session"}'
```

等待几秒后查看：

```bash
docker exec -it coursehub-app bash
```

```bash
python - <<'PY'
import json
import chromadb

client = chromadb.HttpClient(host="chromadb", port=8000)
col = client.get_collection("user_profile")

data = col.get(
    where={"user_id": "profile_user"},
    include=["documents", "metadatas"],
)

for i, doc in enumerate(data["documents"]):
    print("=" * 80)
    print("metadata:", data["metadatas"][i])
    print(json.dumps(json.loads(doc), ensure_ascii=False, indent=2))
PY
```

### 9.7 查看情景记忆 `episodic`

情景记忆只有在当前会话消息数量达到压缩阈值后才会写入。默认阈值在 `MemoryManager.COMPRESS_AT` 中，目前是 15 条消息。

可以连续发送多条消息触发压缩：

```bash
for i in $(seq 1 16); do
  curl -s -X POST http://localhost:8000/chat \
    -H "Content-Type: application/json" \
    -d "{\"message\": \"这是第 $i 条测试消息，我想了解 CSE 100 的先修和名额\", \"user_id\": \"episodic_user\", \"conv_id\": \"episodic_session\"}" > /dev/null
done
```

查看情景记忆：

```bash
docker exec -it coursehub-app bash
```

```bash
python - <<'PY'
import chromadb

client = chromadb.HttpClient(host="chromadb", port=8000)
col = client.get_collection("episodic")

data = col.get(
    where={"user_id": "episodic_user"},
    include=["documents", "metadatas"],
)

for i, doc in enumerate(data["documents"]):
    print("=" * 80)
    print("metadata:", data["metadatas"][i])
    print("summary:", doc)
PY
```

### 9.8 查看 ChromaDB 持久化文件

ChromaDB 的持久化卷在 Compose 中定义为：

```yaml
volumes:
  chromadb-data:
```

查看 Docker volume：

```bash
docker volume ls | grep chromadb
docker volume inspect coursehub_chromadb-data
```

查看容器内数据目录：

```bash
docker exec -it coursehub-chromadb sh
ls -lah /chroma/chroma
find /chroma/chroma -maxdepth 2 -type f | head
```

注意：不建议直接修改这些底层文件。查看和管理数据应优先使用 ChromaDB API 或 Python 客户端。

### 9.9 清空 ChromaDB 数据

谨慎操作。停止服务并删除 volume：

```bash
docker compose down
docker volume rm coursehub_chromadb-data
docker compose up -d --build
```

如果只想删除某个 collection，可以用 Python 客户端：

```bash
docker exec -it coursehub-app bash
```

```bash
python - <<'PY'
import chromadb

client = chromadb.HttpClient(host="chromadb", port=8000)
client.delete_collection("knowledge_base")
print("deleted knowledge_base")
PY
```

删除后重启应用，`KnowledgeBase` 会在 collection 为空时重新导入默认文档。

## 10. Redis 工作记忆查看

Redis 容器名：

```text
coursehub-redis
```

进入 Redis：

```bash
docker exec -it coursehub-redis redis-cli -a coursehub123
```

查看 key：

```redis
KEYS *
```

工作记忆 key 格式：

```text
wm:{user_id}:{conv_id}
```

会话摘要 key 格式：

```text
summary:{user_id}:{conv_id}
```

查看某个会话最近消息：

```redis
LRANGE wm:user_001:session_001 0 -1
```

查看 TTL：

```redis
TTL wm:user_001:session_001
```

默认 TTL 是 24 小时。

## 11. 查看工作记忆压缩内容

工作记忆压缩发生在 `memory/conversation_memory.py` 中。默认配置：

```text
WORKING_MAX = 20
COMPRESS_AT = 15
```

当同一个 `user_id + conv_id` 的工作记忆达到 15 条消息时，系统会：

```text
旧消息 -> LLM 摘要 -> Redis summary
旧消息摘要 -> ChromaDB episodic
最近 5 条消息 -> 继续保留在 Redis wm 列表
```

日志示例：

```text
工作记忆压缩完成: cli_user/5a076f2b-b607-4339-9e9f-f0399862d366，摘要 19 字
```

其中：

```text
user_id = cli_user
conv_id = 5a076f2b-b607-4339-9e9f-f0399862d366
```

### 11.1 查看 Redis 中的会话摘要

进入 Redis：

```bash
docker exec -it coursehub-redis redis-cli -a coursehub123
```

查询摘要：

```redis
GET summary:cli_user:5a076f2b-b607-4339-9e9f-f0399862d366
```

一条命令快速查看：

```bash
docker exec -it coursehub-redis redis-cli -a coursehub123 \
  GET summary:cli_user:5a076f2b-b607-4339-9e9f-f0399862d366
```

### 11.2 查看压缩后仍保留的最近 5 条工作记忆

进入 Redis 后执行：

```redis
LRANGE wm:cli_user:5a076f2b-b607-4339-9e9f-f0399862d366 0 -1
```

一条命令快速查看：

```bash
docker exec -it coursehub-redis redis-cli -a coursehub123 \
  LRANGE wm:cli_user:5a076f2b-b607-4339-9e9f-f0399862d366 0 -1
```

说明：

- Redis 使用 `LPUSH` 写入，最新消息在列表前面。
- 代码读取时会 `reversed(raws)` 还原时间顺序。
- 压缩后 Redis 工作记忆列表只保留最近 5 条；更早的内容会以摘要形式进入 Redis summary 和 ChromaDB `episodic`。

### 11.3 查看 ChromaDB 中的情景记忆摘要

如果是全栈部署，应用容器名通常是：

```text
coursehub-app
```

进入应用容器：

```bash
docker exec -it coursehub-app bash
```

如果你是用 `docker run --rm` 跑 CLI，容器名可能是随机的。先查看：

```bash
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Networks}}\t{{.Status}}'
```

进入对应容器：

```bash
docker exec -it <容器名> bash
```

执行 Python 脚本查询 `episodic`：

```bash
python - <<'PY'
import chromadb

user_id = "cli_user"
conv_id = "5a076f2b-b607-4339-9e9f-f0399862d366"

client = chromadb.HttpClient(host="chromadb", port=8000)
col = client.get_collection("episodic")

data = col.get(
    where={"user_id": user_id},
    include=["documents", "metadatas"],
)

for i, doc in enumerate(data["documents"]):
    meta = data["metadatas"][i]
    if meta.get("conv_id") == conv_id:
        print("=" * 80)
        print("metadata:", meta)
        print("summary:", doc)
        print("full_text_preview:", meta.get("full_text"))
PY
```

字段说明：

| 字段 | 含义 |
|------|------|
| `documents[i]` | LLM 生成的历史对话摘要 |
| `metadata.user_id` | 用户 ID |
| `metadata.conv_id` | 会话 ID |
| `metadata.ts` | 写入时间 |
| `metadata.full_text` | 被压缩的原始旧消息前 500 字预览 |

### 11.4 如果只想看某个用户的所有情景记忆

```bash
docker exec -it coursehub-app bash
```

```bash
python - <<'PY'
import chromadb

user_id = "cli_user"

client = chromadb.HttpClient(host="chromadb", port=8000)
col = client.get_collection("episodic")

data = col.get(
    where={"user_id": user_id},
    include=["documents", "metadatas"],
)

for i, doc in enumerate(data["documents"]):
    print("=" * 80)
    print("metadata:", data["metadatas"][i])
    print("summary:", doc)
PY
```

### 11.5 Redis summary 和 ChromaDB episodic 的区别

| 位置 | 保存内容 | 用途 |
|------|----------|------|
| Redis `summary:{user_id}:{conv_id}` | 当前会话压缩摘要 | 下一次同会话请求直接拼入 prompt |
| ChromaDB `episodic` | 压缩摘要 + metadata | 跨会话按语义检索相关历史 |
| Redis `wm:{user_id}:{conv_id}` | 最近 5 条消息 | 保持当前对话连贯性 |

## 12. Monitor 在线监控

查看监控摘要：

```bash
curl http://localhost:8000/monitor
```

响应包含：

```json
{
  "agent_stats": {
    "general_0": {
      "total": 10,
      "success_rate": 1.0,
      "avg_ms": 1200.3,
      "monitor_penalty": 0.0,
      "routing_score": 0.836
    }
  },
  "tool_stats": {
    "knowledge_search": {
      "total": 5,
      "success_rate": 1.0,
      "avg_latency_ms": 80.2,
      "consecutive_fails": 0,
      "circuit_state": "closed"
    },
    "course_lookup": {
      "total": 3,
      "success_rate": 1.0,
      "avg_latency_ms": 12.4,
      "consecutive_fails": 0,
      "circuit_state": "closed"
    }
  },
  "active_alerts": [],
  "suggestions": []
}
```

指标含义：

| 指标 | 含义 |
|------|------|
| `total` | 调用次数 |
| `success_rate` | 成功率 |
| `avg_ms` / `avg_latency_ms` | 平均延迟 |
| `routing_score` | Agent 路由评分 |
| `monitor_penalty` | Monitor 根据在线表现写回的降权系数 |
| `consecutive_fails` | 工具连续失败次数 |
| `circuit_state` | 工具熔断器状态，可能是 `closed`、`open`、`half_open` |

Prometheus 页面：

```text
http://localhost:9090
```

## 13. 运行端到端评测

```bash
curl -X POST http://localhost:8000/eval/run
```

评测内容：

1. 意图识别准确率和 Macro-F1（内置 14 条中英混合意图用例，覆盖全部 14 个细粒度意图）
2. 调用 Orchestrator 对 5 条对话用例生成真实回复。每条用例钉住一条回答安全约束：多轮记忆与实体延续、名额带快照时间戳、不合成课程 GPA（按教授 × 学期列出）、规划免责声明、个案转介官方渠道
3. LLM-as-Judge 从相关性、准确性、完整性、有用性打分
4. 与上一次评测结果做回归检测
5. 生成优化建议

通过阈值为 0.75（意图准确率与单条对话综合分均按此判定）。

响应示例：

```json
{
  "pass_rate": 0.875,
  "total": 8,
  "passed": 7,
  "avg_scores": {
    "intent_accuracy": 0.857,
    "relevance": 0.88,
    "accuracy": 0.82,
    "completeness": 0.79,
    "helpfulness": 0.85
  },
  "regressions": [],
  "recommendations": [
    "意图识别准确率 < 90%：增加 Few-shot 示例，或对低 F1 的意图类别补充训练数据"
  ],
  "results": []
}
```

## 14. 停止、重启和清理

停止服务：

```bash
docker compose stop
```

重启服务：

```bash
docker compose restart coursehub
```

停止并删除容器，但保留数据卷：

```bash
docker compose down
```

停止并删除容器和数据卷：

```bash
docker compose down -v
```

重新构建并启动：

```bash
docker compose up -d --build
```

## 15. 常见问题

### 15.1 `/health` 返回 503

查看应用日志：

```bash
docker compose logs -f coursehub
```

重点检查：

- `.env` 是否配置 `ANTHROPIC_API_KEY`
- Redis 是否健康
- ChromaDB 是否健康
- 应用容器是否正在反复重启

### 15.2 ChromaDB 连接失败

查看 ChromaDB 状态：

```bash
docker compose ps chromadb
docker compose logs -f chromadb
curl http://localhost:8001/api/v1/heartbeat
```

应用容器内测试：

```bash
docker exec -it coursehub-app bash
python - <<'PY'
import chromadb
client = chromadb.HttpClient(host="chromadb", port=8000)
print(client.heartbeat())
PY
```

### 15.3 Redis 认证失败

确认 `.env` 和 `docker-compose.yml` 中使用的密码一致。默认密码是：

```text
coursehub123
```

测试连接：

```bash
docker exec -it coursehub-redis redis-cli -a coursehub123 ping
```

### 15.4 `/search` 没有结果

先确认知识库中有数据：

```bash
curl http://localhost:8000/knowledge/stats
```

如果是 0，可以重新导入演示文档：

```bash
curl -X POST http://localhost:8000/knowledge/upload \
  -F "file=@data/demo_docs/sample_knowledge.json"
```

完整课程数据未导入时，先执行第 7 节的两步数据管线。再测试：

```bash
curl -X POST "http://localhost:8000/search?query=数据结构课程&top_k=3"
```

### 15.5 用户画像查不到

用户画像是异步更新的，并且依赖 LLM 调用成功。排查步骤：

1. 先调用 `/chat`，使用固定 `user_id`
2. 等待几秒
3. 查看 `docker compose logs -f coursehub` 是否出现 `用户画像已更新`
4. 使用第 8.6 节的 Python 脚本查询 `user_profile`

### 15.6 情景记忆查不到

情景记忆不是每次对话都写入。只有当前会话消息数达到压缩阈值后才写入。默认阈值：

```text
MemoryManager.COMPRESS_AT = 15
```

连续发 16 条以上消息后再查看 `episodic`。

### 15.7 自定义模型返回空回复

推理型模型（如 DeepSeek v4）会先输出 thinking 块，已在代码里调大 max_tokens；若自定义模型出现空回复，检查 max_tokens 是否被 thinking 消耗。

## 16. 推荐验证流程

完整验证可以按这个顺序执行：

```bash
# 1. 启动
docker compose up -d --build

# 2. 健康检查
curl http://localhost:8000/health

# 3. 主对话
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "你好，我想了解 CSE 100", "user_id": "demo_user", "conv_id": "demo_conv"}'

# 4. 知识库统计
curl http://localhost:8000/knowledge/stats

# 5. 导入演示知识库（完整课程数据见第 7 节的两步数据管线）
curl -X POST http://localhost:8000/knowledge/upload \
  -F "file=@data/demo_docs/sample_knowledge.json"

# 6. 检索
curl -X POST "http://localhost:8000/search?query=数据结构课程&top_k=3"

# 7. 监控
curl http://localhost:8000/monitor

# 8. Skills
curl http://localhost:8000/skills

# 9. 评测
curl -X POST http://localhost:8000/eval/run
```
