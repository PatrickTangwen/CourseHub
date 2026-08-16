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


class FakeOrchestrator:
    def __init__(self):
        self.intent_result = _make_intent_result()
        self.run_result = _make_run_result()

    async def recognize_intent(self, message, history=None):
        return self.intent_result

    async def run(self, req):
        return self.run_result


class _FakeMemoryCtx:
    recent_messages = []

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
    assert names == ["run_started", "answer", "done"]

    run_started = events[0][1]
    assert run_started["conv_id"] == "c-1"

    answer = events[1][1]
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


def test_chat_behaviour_unchanged(api):
    """/chat 保持原契约(prefactor 回归护栏)。"""
    client, _, _ = api
    resp = client.post("/chat", json=BODY)
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["conv_id"] == "c-1"
    assert payload["response"] == "CSE 100 covers advanced data structures."
    assert payload["intent_source_scores"] == {"llm": 0.9, "embedding": 0.0, "pattern": 0.7}
