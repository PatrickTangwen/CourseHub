"""阶段事件钩子单测:orchestrator 路由事件 + tool_manager 工具事件。

不依赖网络与真实 LLM:orchestrator 的 _execute 与意图识别被伪件顶替,
工具是本地假 handler。事件经 core.stage_events 的 ContextVar 槽收集。
"""
import asyncio
import sys
import types

import pytest

from core.stage_events import emit_stage, reset_stage_sink, set_stage_sink


class _Collector:
    def __init__(self):
        self.events = []

    async def __call__(self, event, payload):
        self.events.append((event, payload))


def test_emit_stage_without_sink_is_noop():
    async def main():
        await emit_stage("routing_decided", {"x": 1})  # 不应抛错

    asyncio.run(main())


def test_orchestrator_emits_routing_decided(monkeypatch):
    from agents.agent_orchestrator import (
        AgentOrchestrator,
        AgentResponse,
        AgentType,
        Request,
    )
    from core.intent_recognizer import IntentCategory

    orchestrator = AgentOrchestrator(api_key="test-key")

    async def fake_execute(req, agent_type):
        return AgentResponse(agent_type=AgentType.GENERAL, content="Hello!", success=True)

    monkeypatch.setattr(orchestrator, "_execute", fake_execute)

    collector = _Collector()

    async def main():
        token = set_stage_sink(collector)
        try:
            req = Request(
                message="hi",
                user_id="u-1",
                conv_id="c-1",
                intent=IntentCategory.GREETING,
                intent_group="general",
                intent_confidence=0.99,
            )
            return await orchestrator.run(req)
        finally:
            reset_stage_sink(token)

    result = asyncio.run(main())
    assert result.response == "Hello!"

    routing_events = [p for name, p in collector.events if name == "routing_decided"]
    assert len(routing_events) == 1
    payload = routing_events[0]
    assert payload["primary_agent"] == "general"
    assert payload["supporting_agents"] == []
    assert payload["routing_reason"]
    assert isinstance(payload["routing_confidence"], float)


def test_tool_manager_emits_start_and_finish_per_call():
    from mcp.tool_manager import MCPToolManager, Tool

    manager = MCPToolManager(api_key="test-key")

    async def echo_handler(params, context=None):
        return {"echo": params.get("q")}

    for name in ("alpha_tool", "beta_tool"):
        manager.register(Tool(
            name=name,
            description="echo",
            handler=echo_handler,
            schema={"type": "object", "properties": {"q": {"type": "string"}}},
        ))

    collector = _Collector()

    async def main():
        token = set_stage_sink(collector)
        try:
            await manager.call("alpha_tool", {"q": "one"}, use_cache=False)
            await manager.call("beta_tool", {"q": "two"}, use_cache=False)
        finally:
            reset_stage_sink(token)

    asyncio.run(main())

    names = [name for name, _ in collector.events]
    assert names == [
        "tool_call_started", "tool_call_finished",
        "tool_call_started", "tool_call_finished",
    ]
    started_alpha = collector.events[0][1]
    finished_alpha = collector.events[1][1]
    assert started_alpha == {"tool_name": "alpha_tool"}
    assert finished_alpha["tool_name"] == "alpha_tool"
    assert finished_alpha["success"] is True
    assert isinstance(finished_alpha["duration_ms"], float)
    assert collector.events[2][1] == {"tool_name": "beta_tool"}


def test_tool_manager_emits_finish_with_failure_for_missing_tool():
    from mcp.tool_manager import MCPToolManager

    manager = MCPToolManager(api_key="test-key")
    collector = _Collector()

    async def main():
        token = set_stage_sink(collector)
        try:
            return await manager.call("no_such_tool", {}, use_cache=False)
        finally:
            reset_stage_sink(token)

    result = asyncio.run(main())
    assert result.success is False

    names = [name for name, _ in collector.events]
    assert names == ["tool_call_started", "tool_call_finished"]
    assert collector.events[1][1]["success"] is False
