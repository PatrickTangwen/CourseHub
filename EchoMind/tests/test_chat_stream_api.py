"""HTTP seam 测试:/chat/stream(SSE)及其与 /chat 的同形性。

Seam:in-process FastAPI 测试客户端;pipeline 协作者以伪件注入 api.main
模块全局变量;不运行 lifespan(无网络、无真实 LLM),与套件
"stdlib + 伪件"的性质一致。chromadb 未安装,memory.conversation_memory
以 stub 模块顶替(handler 内只用到 MsgRole)。
"""
import json
import sys
import types

import pytest

pytest.importorskip("fastapi")
from fastapi.testclient import TestClient  # noqa: E402


# ── 伪件 ────────────────────────────────────────────────────────────────────

class _V:
    """模仿枚举成员:只带 .value。"""

    def __init__(self, value):
        self.value = value


def _make_intent_result():
    return types.SimpleNamespace(
        intent="course_overview",
        intent_group="facts",
        urgency="normal",
        confidence=0.93,
        entities={"course_code": ["CSE 100"]},
        source_scores={"llm": 0.9, "embedding": 0.0, "pattern": 0.7},
    )


def _make_run_result():
    return types.SimpleNamespace(
        response="CSE 100 covers advanced data structures.",
        intent=_V("course_overview"),
        agent_type=_V("course"),
        agent_types=[_V("course")],
        primary_agent=_V("course"),
        supporting_agents=[],
        routing_reason="intent=course_overview, primary=course",
        routing_confidence=0.88,
        escalated=False,
        latency_ms=12.3,
    )


def _make_route_decision():
    return types.SimpleNamespace(
        primary_agent=_V("course"),
        supporting_agents=[],
        reason="intent=course_overview, primary=course",
        confidence=0.88,
    )


class FakeOrchestrator:
    def __init__(self):
        self.intent_result = _make_intent_result()
        self.run_result = _make_run_result()

    async def recognize_intent(self, message, history=None):
        return self.intent_result

    def route(self, req):
        return _make_route_decision()

    async def run(self, req, decision=None):
        return self.run_result


class _FakeMemoryCtx:
    """形状对齐 MemoryContext:工作记忆 1 条、情景记忆 2 条、有画像、无摘要。"""

    def __init__(self):
        self.recent_messages = [
            types.SimpleNamespace(role=_V("user"), content="earlier question")
        ]
        self.relevant_history = ["h1", "h2"]
        self.user_profile = {"preferred_subject": "CSE"}
        self.summary = ""

    def to_prompt_text(self):
        return ""


class FakeMemory:
    async def get_context(self, user_id, conv_id, query=None):
        return _FakeMemoryCtx()

    async def add_message(self, *args, **kwargs):
        return None

    async def update_profile(self, *args, **kwargs):
        return None


@pytest.fixture()
def api(monkeypatch):
    """返回 (TestClient, api.main 模块, FakeOrchestrator)。"""
    mem_stub = types.ModuleType("memory.conversation_memory")
    mem_stub.MsgRole = types.SimpleNamespace(USER=_V("user"), ASSISTANT=_V("assistant"))
    monkeypatch.setitem(sys.modules, "memory.conversation_memory", mem_stub)

    import api.main as main

    orchestrator = FakeOrchestrator()
    monkeypatch.setattr(main, "_orchestrator", orchestrator)
    monkeypatch.setattr(main, "_memory", FakeMemory())
    monkeypatch.setattr(main, "_tool_manager", None)  # T1:知识检索路径关闭
    return TestClient(main.app), main, orchestrator


# ── SSE 帧解析 ──────────────────────────────────────────────────────────────

def _parse_sse(text):
    """把 SSE 响应体解析为 [(event, payload_dict_or_None), ...]。"""
    events = []
    for block in text.strip().split("\n\n"):
        event, data = None, None
        for line in block.split("\n"):
            if line.startswith("event: "):
                event = line[len("event: "):]
            elif line.startswith("data: "):
                data = line[len("data: "):]
        if event is not None:
            events.append((event, json.loads(data) if data else None))
    return events


BODY = {"message": "What does CSE 100 cover?", "user_id": "u-1", "conv_id": "c-1"}


# ── 测试 ────────────────────────────────────────────────────────────────────

def test_stream_happy_path_event_order(api):
    client, _, _ = api
    resp = client.post("/chat/stream", json=BODY)

    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")

    events = _parse_sse(resp.text)
    names = [name for name, _ in events]
    # API adapter 统一发 run/memory/intent/routing，内核只发布 typed telemetry。
    assert names == [
        "run_started", "memory_recalled", "intent_recognized",
        "routing_decided", "answer", "done",
    ]

    payloads = dict(events)
    assert payloads["run_started"]["conv_id"] == "c-1"

    memory = payloads["memory_recalled"]
    assert memory == {
        "working_messages": 1,
        "episodic_hits": 2,
        "has_profile": True,
        "has_summary": False,
    }

    intent = payloads["intent_recognized"]
    assert intent["intent"] == "course_overview"
    assert intent["intent_group"] == "facts"
    assert intent["intent_confidence"] == 0.93
    assert intent["intent_source_scores"] == {"llm": 0.9, "embedding": 0.0, "pattern": 0.7}

    answer = payloads["answer"]
    assert answer["conv_id"] == "c-1"
    assert answer["response"] == "CSE 100 covers advanced data structures."
    assert answer["escalated"] is False


def test_stream_answer_matches_chat_response(api):
    client, _, _ = api
    chat_resp = client.post("/chat", json=BODY)
    assert chat_resp.status_code == 200

    stream_resp = client.post("/chat/stream", json=BODY)
    events = dict(_parse_sse(stream_resp.text))

    assert events["answer"] == chat_resp.json()


def test_stream_error_event_on_pipeline_failure(api):
    client, _, orchestrator = api

    async def _boom(req):
        raise RuntimeError("boom: secret internal detail")

    orchestrator.run = _boom
    resp = client.post("/chat/stream", json=BODY)

    assert resp.status_code == 200
    events = _parse_sse(resp.text)
    names = [name for name, _ in events]
    assert "error" in names
    assert "answer" not in names
    assert "done" not in names

    error_payload = dict(events)["error"]
    assert error_payload["message"]
    assert "boom" not in error_payload["message"]  # 内部细节不外泄


def test_stream_503_when_service_not_ready(api):
    client, main, _ = api
    main._orchestrator = None
    try:
        resp = client.post("/chat/stream", json=BODY)
        assert resp.status_code == 503
    finally:
        pass  # monkeypatch 会在 teardown 恢复


def test_stream_course_question_emits_tool_events(api, monkeypatch):
    """课程问题走真实 tool_manager(假 handler):工具事件出现在
    routing_decided 之后;问候类无工具事件由伪 orchestrator 流保证。"""
    client, main, orchestrator = api

    from agents.agent_orchestrator import AgentOrchestrator, AgentResponse, AgentType
    from core.intent_recognizer import IntentCategory
    from mcp.tool_manager import MCPToolManager, Tool

    # 真实 orchestrator,意图识别与执行为伪件
    real_orchestrator = AgentOrchestrator(api_key="test-key")
    intent_result = types.SimpleNamespace(
        intent=IntentCategory.COURSE_OVERVIEW,
        intent_group="facts",
        urgency=None,
        confidence=0.95,
        entities={},
        source_scores={"llm": 0.95, "embedding": 0.0, "pattern": 0.6},
    )

    async def fake_recognize(message, history=None):
        return intent_result

    async def fake_execute(req, agent_type):
        return AgentResponse(agent_type=AgentType.COURSE, content="CSE 100 is about data structures.", success=True)

    monkeypatch.setattr(real_orchestrator, "recognize_intent", fake_recognize)
    monkeypatch.setattr(real_orchestrator, "_execute", fake_execute)
    monkeypatch.setattr(main, "_orchestrator", real_orchestrator)

    # 真实 tool_manager,注册假 knowledge_search;绕过 LLM 改写,直走 call()
    manager = MCPToolManager(api_key="test-key")

    async def knowledge_handler(params, context=None):
        return [{"title": "CSE 100", "content": "Advanced data structures.", "score": 0.92}]

    manager.register(Tool(
        name="knowledge_search",
        description="fake",
        handler=knowledge_handler,
        schema={"type": "object", "properties": {"query": {"type": "string"}, "top_k": {"type": "integer"}}},
    ))

    async def fake_search_with_rewrite(tool_name, query, top_k=3, **kwargs):
        return await manager.call(tool_name, {"query": query, "top_k": top_k}, use_cache=False)

    monkeypatch.setattr(manager, "search_with_rewrite", fake_search_with_rewrite)
    monkeypatch.setattr(main, "_tool_manager", manager)

    resp = client.post("/chat/stream", json=BODY)
    assert resp.status_code == 200
    events = _parse_sse(resp.text)
    names = [name for name, _ in events]

    assert names[0] == "run_started"
    assert "tool_call_started" in names
    assert "tool_call_finished" in names
    assert "routing_decided" in names
    assert names[-2:] == ["answer", "done"]
    assert names.index("intent_recognized") < names.index("routing_decided")
    assert names.index("routing_decided") < names.index("tool_call_started")
    assert names.index("tool_call_started") < names.index("tool_call_finished")

    payloads = dict(events)
    assert payloads["tool_call_started"]["tool_name"] == "knowledge_search"
    finished = payloads["tool_call_finished"]
    assert finished["success"] is True
    assert isinstance(finished["duration_ms"], float)
    assert payloads["routing_decided"]["primary_agent"] == "course"
    assert payloads["answer"]["knowledge_used"] is True


def test_stream_greeting_emits_no_tool_events(api, monkeypatch):
    """问候类请求不触发检索 → 全事件序列里没有任何工具事件(#21 AC)。
    真实 orchestrator + 已注册工具的真实 tool_manager,确保"没有工具事件"
    是按意图跳过检索的结果,而不是没有工具可调。"""
    client, main, _ = api

    from agents.agent_orchestrator import AgentOrchestrator, AgentResponse, AgentType
    from core.intent_recognizer import IntentCategory
    from mcp.tool_manager import MCPToolManager, Tool

    real_orchestrator = AgentOrchestrator(api_key="test-key")
    intent_result = types.SimpleNamespace(
        intent=IntentCategory.GREETING,
        intent_group="general",
        urgency=None,
        confidence=0.99,
        entities={},
        source_scores={"llm": 1.0},
    )

    async def fake_recognize(message, history=None):
        return intent_result

    async def fake_execute(req, agent_type):
        return AgentResponse(agent_type=AgentType.GENERAL, content="Hello!", success=True)

    monkeypatch.setattr(real_orchestrator, "recognize_intent", fake_recognize)
    monkeypatch.setattr(real_orchestrator, "_execute", fake_execute)
    monkeypatch.setattr(main, "_orchestrator", real_orchestrator)

    manager = MCPToolManager(api_key="test-key")

    async def knowledge_handler(params, context=None):
        return [{"title": "t", "content": "c", "score": 1.0}]

    manager.register(Tool(
        name="knowledge_search",
        description="fake",
        handler=knowledge_handler,
        schema={"type": "object", "properties": {"query": {"type": "string"}}},
    ))
    monkeypatch.setattr(main, "_tool_manager", manager)

    resp = client.post("/chat/stream", json={"message": "hi", "user_id": "u-1", "conv_id": "c-9"})
    assert resp.status_code == 200
    names = [name for name, _ in _parse_sse(resp.text)]
    assert names == [
        "run_started", "memory_recalled", "intent_recognized",
        "routing_decided", "answer", "done",
    ]


def test_chat_behaviour_unchanged(api):
    """/chat 保持原契约(prefactor 回归护栏)。"""
    client, _, _ = api
    resp = client.post("/chat", json=BODY)
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["conv_id"] == "c-1"
    assert payload["response"] == "CSE 100 covers advanced data structures."
    assert payload["intent_source_scores"] == {"llm": 0.9, "embedding": 0.0, "pattern": 0.7}
