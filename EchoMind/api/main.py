"""
CourseHub · UCSD 课程问答助手 — FastAPI 入口

启动时打印小熊饼干图案。
所有核心组件在 lifespan 中初始化，通过环境变量配置。
"""
import asyncio
import json
import logging
import os
import pathlib
import sys
import uuid
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional


_ROOT = str(pathlib.Path(__file__).parent.parent.resolve())
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Response, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from pydantic import BaseModel, Field

load_dotenv()

from coursedata.normalize import ACTIVE_PLANNING_TERM  # noqa: E402

logging.basicConfig(
    level=getattr(logging, os.getenv("LOG_LEVEL", "INFO")),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

BANNER = r"""
    ʕ•ᴥ•ʔ  ʕ•ᴥ•ʔ  ʕ•ᴥ•ʔ
   ╔══════════════════════════╗
   ║   CourseHub  v1.0        ║
   ║   UCSD 课程问答 AI 助手   ║
   ╚══════════════════════════╝
    ʕ•ᴥ•ʔ  ʕ•ᴥ•ʔ  ʕ•ᴥ•ʔ
"""

# ── 全局组件（lifespan 中初始化）─────────────────────────────────────────────
_orchestrator = None
_memory       = None
_tool_manager = None
_monitor      = None
_evaluator    = None
_skill_manager = None
_knowledge_base = None

def _anthropic_cfg() -> Dict[str, Any]:
    key = os.getenv("ANTHROPIC_API_KEY", "")
    if not key:
        raise RuntimeError("未设置 ANTHROPIC_API_KEY")
    cfg: Dict[str, Any] = {
        "api_key":  key,
        "model":    os.getenv("ANTHROPIC_MODEL", "claude-3-5-sonnet-20241022").strip(),
    }
    base_url = os.getenv("ANTHROPIC_BASE_URL", "").strip()
    if base_url:
        cfg["base_url"] = base_url
    return cfg


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _orchestrator, _memory, _tool_manager, _monitor, _evaluator, _skill_manager, _knowledge_base

    print(BANNER, flush=True)

    from agents.agent_orchestrator import AgentOrchestrator, Request
    from core.intent_recognizer import IntentRecognizer
    from coursedata.bootstrap import ensure_course_data_artifacts
    from evaluation.evaluator import EndToEndEvaluator
    from mcp.knowledge_base import KnowledgeBase
    from mcp.tool_manager import MCPToolManager, Tool
    from memory.conversation_memory import MemoryManager
    from monitor.performance_monitor import PerformanceMonitor
    from core.skill_loader import SkillManager

    cfg = _anthropic_cfg()
    logger.info(f"模型: {cfg['model']}  base_url: {cfg.get('base_url', '(官方)')}")

    # Runtime artifacts are derived from the checked-in snapshots. A clean clone
    # therefore reaches the same Course Index/knowledge state as a warm deployment.
    course_data_dir = pathlib.Path(os.getenv(
        "COURSEHUB_DATA_DIR",
        str(pathlib.Path(_ROOT) / "data" / "coursehub"),
    ))
    snapshots_dir = pathlib.Path(os.getenv(
        "COURSEHUB_SNAPSHOTS_DIR",
        str(
            pathlib.Path(_ROOT).parent
            / "ucsd-course-data" / "01-current-published-data"
            / "api" / "static" / "catalogs" / "public"
        ),
    ))
    if not course_data_dir.is_absolute():
        course_data_dir = pathlib.Path(_ROOT) / course_data_dir
    if not snapshots_dir.is_absolute():
        snapshots_dir = pathlib.Path(_ROOT) / snapshots_dir
    bootstrap_result = await asyncio.to_thread(
        ensure_course_data_artifacts,
        snapshots_dir,
        course_data_dir,
    )
    course_index_path = pathlib.Path(bootstrap_result["index_path"])
    course_docs_path = pathlib.Path(bootstrap_result["docs_path"])
    os.environ["COURSEHUB_DICTIONARIES_PATH"] = bootstrap_result["dictionaries_path"]
    logger.info(
        "课程数据已就绪: snapshots=%s rebuilt=%s index=%s",
        bootstrap_result["snapshots"],
        bootstrap_result["rebuilt"],
        course_index_path,
    )

    # 意图识别器（Orchestrator 内部也会创建，这里单独暴露给 Evaluator）
    recognizer = IntentRecognizer(
        api_key=cfg["api_key"],
        base_url=cfg.get("base_url"),
        model=cfg["model"],
    )

    # Skills：启动时从目录加载业务能力说明，并在 Agent 调用 LLM 时动态注入。
    skills_dir = os.getenv("COURSEHUB_SKILLS_DIR", str(pathlib.Path(_ROOT) / "skills"))
    _skill_manager = SkillManager(
        root_dir=skills_dir,
        max_prompt_chars=int(os.getenv("COURSEHUB_SKILLS_MAX_PROMPT_CHARS", "5000")),
    )
    _skill_manager.load()

    # Agent 编排器
    _orchestrator = AgentOrchestrator(
        api_key=cfg["api_key"],
        base_url=cfg.get("base_url"),
        model=cfg["model"],
        skill_manager=_skill_manager,
    )

    # 记忆管理器（Redis 工作记忆 + ChromaDB 情景记忆/用户画像）
    _memory = MemoryManager(
        redis_url=os.getenv("REDIS_URL", "redis://redis:6379/0"),
        chroma_host=os.getenv("CHROMA_HOST", "chromadb"),
        chroma_port=int(os.getenv("CHROMA_PORT", "8000")),
        chroma_path=os.getenv("CHROMA_PERSIST_DIRECTORY", "/app/data/chroma"),
        api_key=cfg["api_key"],
        base_url=cfg.get("base_url"),
        model=cfg["model"],
    )

    # MCP 工具管理器 + RAG 知识库（基于 ChromaDB 的真实检索）
    _tool_manager = MCPToolManager(
        api_key=cfg["api_key"],
        base_url=cfg.get("base_url"),
        model=cfg["model"],
    )
    kb = KnowledgeBase(
        chroma_host=os.getenv("CHROMA_HOST", "chromadb"),
        chroma_port=int(os.getenv("CHROMA_PORT", "8000")),
        chroma_path=os.getenv("CHROMA_PERSIST_DIRECTORY", "/app/data/chroma"),
    )
    _knowledge_base = kb
    imported_chunks = await kb.ensure_course_documents_async(
        course_docs_path,
        force=bool(bootstrap_result["rebuilt"]),
    )
    knowledge_stats = await kb.stats_async()
    logger.info("知识库已加载: %s; 本次导入 %s 个课程片段", knowledge_stats, imported_chunks)

    def knowledge_fallback(params: Dict[str, Any], context: Optional[Dict[str, Any]], error: str):
        query = params.get("query", "")
        return [{
            "title": "知识库降级结果",
            "content": f"知识库暂时不可用，未能完成对“{query}”的语义检索。请稍后重试；课程信息也可以在 UCSD 官方目录和 WebReg 中确认。",
            "score": 0.0,
            "fallback": True,
            "error": error,
        }]

    _tool_manager.register(Tool(
        name="knowledge_search",
        description="搜索知识库（基于 ChromaDB 向量检索）",
        handler=kb.search_handler,
        schema={
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "top_k": {"type": "integer"},
            },
            "required": ["query"],
        },
        cache_ttl=300.0,
        supports_rerank=True,
        fallback=knowledge_fallback,
    ))

    # Course Index is a required runtime dependency; bootstrap above fails startup
    # rather than allowing a superficially healthy service without course_lookup.
    from mcp.course_lookup import register_course_lookup
    register_course_lookup(_tool_manager, course_index_path)

    # 性能监控（可选启动 Prometheus）
    prom_port = int(os.getenv("PROMETHEUS_PORT", "0")) or None
    _monitor = PerformanceMonitor(
        orchestrator=_orchestrator,
        tool_manager=_tool_manager,
        interval_s=float(os.getenv("MONITOR_INTERVAL", "10")),
        webhook_url=os.getenv("ALERT_WEBHOOK_URL") or None,
        prometheus_port=prom_port,
    )
    await _monitor.start()

    # 评测器（context_builder 让对话评测走与 /chat 相同的混合检索管线）
    async def _eval_context_builder(message: str, intent, entities) -> str:
        text, _ = await _build_knowledge_context(message, intent=intent, entities=entities)
        return text

    _evaluator = EndToEndEvaluator(
        orchestrator=_orchestrator,
        recognizer=recognizer,
        api_key=cfg["api_key"],
        base_url=cfg.get("base_url"),
        model=cfg["model"],
        baseline_path=os.getenv("EVAL_BASELINE_PATH", "/app/data/eval/baseline.json"),
        context_builder=_eval_context_builder,
    )

    logger.info("CourseHub 已就绪")
    yield

    await _monitor.stop()
    if _memory is not None:
        await _memory.close()
    logger.info("CourseHub 已关闭")


# ── FastAPI ───────────────────────────────────────────────────────────────────
app = FastAPI(
    title="CourseHub · UCSD 课程问答助手",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── 请求/响应模型 ─────────────────────────────────────────────────────────────
class ChatRequest(BaseModel):
    message:     str
    user_id:     str = "anonymous"
    conv_id:     Optional[str] = None


class ChatResponse(BaseModel):
    conv_id:     str
    response:    str
    intent:      str
    intent_group: str = "other"
    agent_type:  str
    agent_types: List[str] = Field(default_factory=list)
    primary_agent: str = ""
    supporting_agents: List[str] = Field(default_factory=list)
    routing_reason: str = ""
    routing_confidence: float = 0.0
    escalated:   bool
    latency_ms:  float
    knowledge_used: bool = False
    entities: Dict[str, List[str]] = Field(default_factory=dict)
    intent_confidence: float = 0.0
    intent_source_scores: Dict[str, float] = Field(default_factory=dict)


# ── 路由 ──────────────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    if _orchestrator is None or _tool_manager is None or _knowledge_base is None:
        raise HTTPException(503, "服务未就绪")
    has_course_documents = await _knowledge_base.has_course_documents_async()
    if "course_lookup" not in _tool_manager.get_stats() or not has_course_documents:
        raise HTTPException(503, "课程数据未就绪")
    return {"status": "ok", "agents": _orchestrator.get_stats()}


@app.get("/skills", tags=["Skills"])
async def skills_summary():
    """查看当前已加载的 Skills，便于确认热加载结果和排查解析错误。"""
    if _skill_manager is None:
        raise HTTPException(503, "Skills 未初始化")
    return _skill_manager.summary()


@app.post("/skills/reload", tags=["Skills"])
async def reload_skills():
    """运行时重新扫描 Skill 目录，不需要重启服务。"""
    if _skill_manager is None:
        raise HTTPException(503, "Skills 未初始化")
    _skill_manager.reload()
    if _orchestrator is not None:
        _orchestrator.set_skill_manager(_skill_manager)
    return _skill_manager.summary()


async def _run_chat_pipeline(req: ChatRequest, emit=None) -> ChatResponse:
    """
    /chat 与 /chat/stream 共用的 pipeline 编排序列：
      记忆读取 → 意图识别 → 知识检索 → Agent 执行 → 记忆写入

    emit(event: str, payload: dict) 为可选异步回调，流式端点传入后在
    关键节点之间发阶段事件（协议见 docs/specs/coursehub-frontend.md §3.1）。
    """
    from agents.agent_orchestrator import Request as OrcReq
    from memory.conversation_memory import MsgRole

    conv_id = req.conv_id or str(uuid.uuid4())
    if emit is not None:
        await emit("run_started", {"conv_id": conv_id})

    # 1. 读取记忆上下文
    mem_ctx = await _memory.get_context(req.user_id, conv_id, query=req.message)

    # 2. 构建编排请求（含对话历史，用于意图识别上下文）
    history = [
        {"role": m.role.value, "content": m.content}
        for m in mem_ctx.recent_messages[-5:]
    ] if mem_ctx.recent_messages else None

    intent_result = await _orchestrator.recognize_intent(req.message, history=history)
    knowledge_text, knowledge_used = await _build_knowledge_context(
        req.message, intent=intent_result.intent, entities=intent_result.entities,
    )
    context_parts = [mem_ctx.to_prompt_text()]
    if knowledge_text:
        context_parts.append(knowledge_text)
    full_context = "\n\n".join(part for part in context_parts if part)

    orch_req = OrcReq(
        message=req.message,
        user_id=req.user_id,
        conv_id=conv_id,
        context=full_context,
        history=history,
        entities=intent_result.entities,
        intent=intent_result.intent,
        intent_group=intent_result.intent_group,
        urgency=intent_result.urgency,
        intent_confidence=intent_result.confidence,
    )

    # 3. 执行
    result = await _orchestrator.run(orch_req)

    # 4. 写入记忆
    await _memory.add_message(req.user_id, conv_id, MsgRole.USER, req.message)
    await _memory.add_message(req.user_id, conv_id, MsgRole.ASSISTANT, result.response)

    # 5. 异步更新用户画像（不阻塞响应）
    asyncio.create_task(_memory.update_profile(req.user_id, conv_id))

    return ChatResponse(
        conv_id=conv_id,
        response=result.response,
        intent=result.intent.value if result.intent else "other",
        intent_group=intent_result.intent_group,
        agent_type=result.agent_type.value,
        agent_types=[agent_type.value for agent_type in result.agent_types],
        primary_agent=result.primary_agent.value if result.primary_agent else result.agent_type.value,
        supporting_agents=[agent_type.value for agent_type in result.supporting_agents],
        routing_reason=result.routing_reason,
        routing_confidence=result.routing_confidence,
        escalated=result.escalated,
        latency_ms=round(result.latency_ms, 1),
        knowledge_used=knowledge_used,
        entities=intent_result.entities,
        intent_confidence=round(intent_result.confidence, 4),
        intent_source_scores=intent_result.source_scores,
    )


@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    """主对话接口（非流式）。保留为测试入口与流式建立失败时的回退。"""
    if _orchestrator is None or _memory is None:
        raise HTTPException(503, "服务未就绪")
    return await _run_chat_pipeline(req)


@app.post("/chat/stream")
async def chat_stream(req: ChatRequest):
    """
    流式对话接口（SSE）。与 /chat 走同一编排序列，在阶段之间发事件；
    最终 answer 事件与 /chat 响应同形，答案整段到达。
    """
    if _orchestrator is None or _memory is None:
        raise HTTPException(503, "服务未就绪")

    queue: asyncio.Queue = asyncio.Queue()

    async def emit(event: str, payload: Dict[str, Any]) -> None:
        await queue.put((event, payload))

    async def _runner() -> None:
        try:
            resp = await _run_chat_pipeline(req, emit=emit)
            await emit("answer", resp.model_dump())
            await emit("done", {})
        except Exception:
            logger.exception("chat_stream pipeline 失败")
            await emit("error", {"message": "The assistant hit an internal error. Please try again."})
        finally:
            await queue.put(None)

    async def _sse():
        runner = asyncio.create_task(_runner())
        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                event, payload = item
                yield f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"
        finally:
            if not runner.done():
                runner.cancel()

    return StreamingResponse(
        _sse(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def _build_knowledge_context(
    message: str, intent=None, entities=None, top_k: int = 3,
) -> tuple[str, bool]:
    """
    为 /chat 主链路构建混合检索上下文（ADR-0001）。

    语义侧复用 MCPToolManager 的查询改写、并行召回、重排、fallback 能力；
    结构化侧在实体命中 course_code/instructor 时并行调用 course_lookup。
    两路结果共同拼进上下文，主链路形状不变。
    """
    if _tool_manager is None:
        return "", False
    if not _should_use_knowledge(message, intent=intent):
        return "", False
    try:
        semantic_task = _tool_manager.search_with_rewrite("knowledge_search", message, top_k=top_k)
        lookup_task = _build_course_lookup_context(intent, entities)
        result, lookup_text = await asyncio.gather(semantic_task, lookup_task)

        parts = []
        semantic_parts = []
        if result.success and isinstance(result.data, list):
            for i, item in enumerate(result.data[:top_k], start=1):
                if not isinstance(item, dict):
                    continue
                title = str(item.get("title", "未命名文档"))
                content = str(item.get("content", "")).strip()
                score = item.get("score", "")
                if not content:
                    continue
                semantic_parts.append(f"{i}. 标题: {title}\n   相关度: {score}\n   内容: {content[:600]}")
        if semantic_parts:
            parts.append("[知识库检索结果]\n" + "\n".join(semantic_parts))
        if lookup_text:
            parts.append(lookup_text)

        if not parts:
            return "", False
        parts.append(
            "请优先依据以上检索内容回答。精确数字（名额、上课时间、GPA、学分）只能引用"
            "[课程数据查询结果]中的数值；名额必须注明 availability_timestamp 或数据生成时间，"
            "并说明非实时。检索内容不足时如实说明数据未覆盖。"
        )
        return "\n\n".join(parts), True
    except Exception as ex:
        logger.warning(f"构建知识库上下文失败: {ex}")
        return "", False


async def _build_course_lookup_context(intent=None, entities=None) -> str:
    """实体命中时调用 course_lookup（结构化 Course Index 查询），返回上下文文本块。

    截断只做结构级（丢弃整条记录并标注省略数），绝不按字符切 JSON——
    被切坏的数字比没有数字更危险（ADR-0001）。
    """
    if _tool_manager is None or not entities:
        return ""
    from mcp.course_lookup import plan_course_lookup_calls

    calls, term_defaulted = plan_course_lookup_calls(intent, entities)
    if not calls:
        return ""

    results = await asyncio.gather(
        *[_tool_manager.call("course_lookup", p) for p in calls],
        return_exceptions=True,
    )
    parts = []
    for params, result in zip(calls, results):
        if isinstance(result, Exception):
            continue
        if not getattr(result, "success", False) or not isinstance(result.data, dict):
            continue
        if result.data.get("fallback"):
            continue  # 降级结果不能冒充权威数据
        label = params.get("course_code") or params.get("instructor") or params.get("subject") or ""
        payload = json.dumps(_compact_lookup_data(result.data), ensure_ascii=False, default=str)
        parts.append(f"- {params['action']} {label}: {payload}")
    if not parts:
        return ""
    header = "[课程数据查询结果]"
    if term_defaulted:
        header += f"（用户未指定学期，默认查询 {ACTIVE_PLANNING_TERM}）"
    return header + "\n" + "\n".join(parts)


def _compact_lookup_data(data: Dict[str, Any]) -> Dict[str, Any]:
    """结构级压缩 course_lookup 结果：整条丢弃并标注省略数，不切字符。"""
    MAX_RESULTS = 12       # grades/instructor/search 行数上限
    MAX_SECTIONS = 8       # 每门课程保留的 section 数上限
    MAX_DESCRIPTION = 300  # description 由语义检索承载，这里只留摘要

    compact = dict(data)
    results = list(compact.get("results") or [])
    omitted = max(0, len(results) - MAX_RESULTS)
    results = results[:MAX_RESULTS]

    slimmed = []
    for item in results:
        if not isinstance(item, dict):
            slimmed.append(item)
            continue
        item = dict(item)
        desc = item.get("description")
        if isinstance(desc, str) and len(desc) > MAX_DESCRIPTION:
            item["description"] = desc[:MAX_DESCRIPTION] + "…"
        sections = item.get("sections")
        if isinstance(sections, list) and len(sections) > MAX_SECTIONS:
            item["sections"] = sections[:MAX_SECTIONS]
            item["sections_omitted"] = len(sections) - MAX_SECTIONS
        slimmed.append(item)

    compact["results"] = slimmed
    if omitted:
        compact["results_omitted"] = omitted
    return compact


def _should_use_knowledge(message: str, intent=None) -> bool:
    """跳过纯寒暄和转介类问题，课程类问题才检索知识库，避免无关 RAG 干扰回复。"""
    msg = (message or "").strip().lower()
    if not msg:
        return False
    intent_value = getattr(intent, "value", intent)
    if intent_value in {"greeting", "escalation", "advisor_referral", "other"}:
        return False
    if intent_value in {
        "facts", "planning", "meta_info",
        "course_overview", "prerequisites", "schedule", "availability",
        "instructor_lookup", "grades_history", "course_search",
        "plan_sequence", "workload_advice", "professor_choice",
    }:
        return True
    greetings = {"你好", "您好", "嗨", "hi", "hello", "hey", "早上好", "晚上好"}
    if msg in greetings:
        return False
    course_keywords = [
        "课", "先修", "学分", "名额", "教授", "老师", "成绩", "gpa", "选课",
        "上课", "教室", "waitlist", "course", "class", "prereq", "units",
        "professor", "instructor", "schedule", "seat", "grade",
    ]
    return len(msg) >= 4 or any(kw in msg for kw in course_keywords)


@app.get("/monitor")
async def monitor_summary():
    """实时监控摘要：Agent 成功率、工具统计、告警、优化建议。"""
    if _monitor is None:
        raise HTTPException(503, "服务未就绪")
    return _monitor.summary()


@app.get("/metrics")
async def prometheus_metrics():
    """Prometheus 指标入口。"""
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.post("/search")
async def search(query: str, top_k: int = 5):
    """
    演示检索优化链路：查询改写 → 并行召回 → 重排 → Top-K。
    展示 MCP 工具调用的核心亮点。
    """
    if _tool_manager is None:
        raise HTTPException(503, "服务未就绪")
    result = await _tool_manager.search_with_rewrite("knowledge_search", query, top_k=top_k)
    return {"query": query, "results": result.data, "reranked": result.reranked}


class DocInput(BaseModel):
    """单篇文档输入。metadata 可选（如 subject/terms_offered），随片段写入向量库。"""
    title:   str
    content: str
    metadata: Optional[Dict[str, Any]] = None


class BatchDocInput(BaseModel):
    """批量文档导入请求体。"""
    documents: List[DocInput]


class EvalIntentInput(BaseModel):
    """意图识别评测用例。"""
    message: str
    expected_intent: str
    context: Optional[Dict[str, Any]] = None


class EvalDialogInput(BaseModel):
    """对话质量评测用例。question 单轮，turns 多轮。"""
    question: Optional[str] = None
    turns: Optional[List[str]] = None
    user_id: Optional[str] = None
    conv_id: Optional[str] = None


class EvalRunInput(BaseModel):
    """评测请求。为空时使用内置默认用例。"""
    intent_cases: Optional[List[EvalIntentInput]] = None
    dialog_cases: Optional[List[EvalDialogInput]] = None


@app.post("/knowledge/add", tags=["知识库"])
async def add_knowledge(body: BatchDocInput):
    """
    批量导入文档到知识库。

    文档会自动切片（每片 500 字）并存入 ChromaDB，ChromaDB 内置 Embedding 模型自动向量化。

    示例请求体：
    ```json
    {
      "documents": [
        {"title": "CSE 100 学习建议", "content": "建议先掌握数据结构与算法分析..."},
        {"title": "选课准备", "content": "选课前请核对先修课、时间冲突和学分负担..."}
      ]
    }
    ```
    """
    if _knowledge_base is None:
        raise HTTPException(503, "知识库未初始化")
    kb = _knowledge_base
    count = await kb.add_documents_async([
        {"title": d.title, "content": d.content, "metadata": d.metadata or {}}
        for d in body.documents
    ])
    total = await kb.doc_count_async()
    return {"message": f"成功导入 {count} 个文档片段", "added_chunks": count, "total_chunks": total}


@app.post("/knowledge/upload", tags=["知识库"])
async def upload_knowledge(file: UploadFile = File(...)):
    """
    上传文件导入知识库。

    支持格式：
    - `.txt` / `.md`：整个文件作为一篇文档，文件名作为标题
    - `.json`：JSON 数组格式 `[{"title": "...", "content": "..."}, ...]`

    文件大小限制：10MB
    """
    if _knowledge_base is None:
        raise HTTPException(503, "知识库未初始化")
    kb = _knowledge_base

    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(413, "文件大小超过 10MB 限制")

    text = content.decode("utf-8", errors="ignore")
    filename = file.filename or "unknown"

    if filename.endswith(".json"):
        import json as _json
        try:
            docs = _json.loads(text)
            if not isinstance(docs, list):
                raise HTTPException(400, "JSON 文件应为数组格式: [{title, content}, ...]")
        except _json.JSONDecodeError as e:
            raise HTTPException(400, f"JSON 解析失败: {e}")
    else:
        # txt / md：整个文件作为一篇文档
        title = filename.rsplit(".", 1)[0] if "." in filename else filename
        docs = [{"title": title, "content": text}]

    count = await kb.add_documents_async(docs)
    total = await kb.doc_count_async()
    return {
        "message": f"文件 {filename} 导入成功",
        "added_chunks": count,
        "total_chunks": total,
    }


@app.get("/knowledge/stats", tags=["知识库"])
async def knowledge_stats():
    """查看知识库的片段、逻辑文档和课程文档统计。"""
    if _knowledge_base is None:
        raise HTTPException(503, "知识库未初始化")
    return await _knowledge_base.stats_async()


@app.post("/eval/run")
async def run_eval(body: Optional[EvalRunInput] = None):
    """运行内置评测用例，返回评测报告。"""
    if _evaluator is None:
        raise HTTPException(503, "服务未就绪")
    from evaluation.evaluator import DEFAULT_DIALOG_CASES, DEFAULT_INTENT_CASES, IntentTestCase

    if body and body.intent_cases is not None:
        intent_cases = [
            IntentTestCase(
                message=c.message,
                expected_intent=c.expected_intent,
                context=c.context,
            )
            for c in body.intent_cases
        ]
    else:
        intent_cases = DEFAULT_INTENT_CASES

    if body and body.dialog_cases is not None:
        dialog_cases = [
            c.model_dump(exclude_none=True)
            for c in body.dialog_cases
        ]
    else:
        dialog_cases = DEFAULT_DIALOG_CASES

    report = await _evaluator.run(
        intent_cases=intent_cases,
        dialog_cases=dialog_cases,
    )
    return {
        "pass_rate":       report.pass_rate,
        "total":           report.total,
        "passed":          report.passed,
        "avg_scores":      report.avg_scores,
        "regressions":     report.regressions,
        "recommendations": report.recommendations,
        "results": [
            {
                "test_id": r.test_id,
                "passed": r.passed,
                "scores": r.scores,
                "detail": r.detail,
                "metadata": r.metadata,
            }
            for r in report.results
        ],
    }


# ── 交互式 CLI ────────────────────────────────────────────────────────────────
async def _cli():
    print(BANNER)
    print("CourseHub CLI — 输入 quit 退出\n")

    from agents.agent_orchestrator import AgentOrchestrator, Request
    from memory.conversation_memory import MemoryManager, MsgRole
    from core.skill_loader import SkillManager

    cfg = _anthropic_cfg()
    skill_manager = SkillManager(
        root_dir=os.getenv("COURSEHUB_SKILLS_DIR", str(pathlib.Path(_ROOT) / "skills")),
        max_prompt_chars=int(os.getenv("COURSEHUB_SKILLS_MAX_PROMPT_CHARS", "5000")),
    )
    skill_manager.load()
    orch = AgentOrchestrator(
        api_key=cfg["api_key"],
        base_url=cfg.get("base_url"),
        model=cfg["model"],
        skill_manager=skill_manager,
    )
    mem  = MemoryManager(
        redis_url=os.getenv("REDIS_URL", "redis://localhost:6379/0"),
        chroma_host=os.getenv("CHROMA_HOST", "localhost"),
        chroma_port=int(os.getenv("CHROMA_PORT", "8000")),
        chroma_path=os.getenv("CHROMA_PERSIST_DIRECTORY", "/tmp/chroma"),
        api_key=cfg["api_key"],
        base_url=cfg.get("base_url"),
        model=cfg["model"],
    )

    user_id, conv_id = "cli_user", str(uuid.uuid4())

    while True:
        try:
            msg = input("你: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\n再见 ʕ•ᴥ•ʔ")
            break
        if not msg or msg.lower() in ("quit", "exit", "退出"):
            print("再见 ʕ•ᴥ•ʔ")
            break

        ctx = await mem.get_context(user_id, conv_id, query=msg)
        history = [
            {"role": m.role.value, "content": m.content}
            for m in ctx.recent_messages[-5:]
        ] if ctx.recent_messages else None
        req = Request(message=msg, user_id=user_id, conv_id=conv_id, context=ctx.to_prompt_text(), history=history)
        result = await orch.run(req)

        await mem.add_message(user_id, conv_id, MsgRole.USER, msg)
        await mem.add_message(user_id, conv_id, MsgRole.ASSISTANT, result.response)

        print(f"\nCourseHub [{result.agent_type.value}]: {result.response}\n")

    await mem.close()


if __name__ == "__main__":
    if "--cli" in sys.argv:
        asyncio.run(_cli())
    else:
        uvicorn.run(
            "api.main:app",
            host=os.getenv("API_HOST", "0.0.0.0"),
            port=int(os.getenv("API_PORT", "8000")),
            reload=os.getenv("APP_ENV") == "development",
        )
