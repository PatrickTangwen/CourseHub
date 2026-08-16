"""协议无关 telemetry seam 的隔离与工具调用信号。"""

import asyncio

from core.telemetry import (
    ToolCallFinished,
    ToolCallStarted,
    emit_telemetry,
    reset_telemetry_sink,
    set_telemetry_sink,
)


class _Collector:
    def __init__(self):
        self.signals = []

    async def __call__(self, signal):
        self.signals.append(signal)


def test_emit_telemetry_without_sink_is_noop():
    asyncio.run(emit_telemetry(ToolCallStarted(tool_name="course_lookup")))


def test_tool_manager_publishes_typed_start_and_finish_signals():
    from mcp.tool_manager import MCPToolManager, Tool

    manager = MCPToolManager(api_key="test-key")

    async def echo_handler(params, context=None):
        return {"echo": params.get("q")}

    manager.register(Tool(
        name="course_lookup",
        description="echo",
        handler=echo_handler,
        schema={"type": "object", "properties": {"q": {"type": "string"}}},
    ))
    collector = _Collector()

    async def main():
        token = set_telemetry_sink(collector)
        try:
            await manager.call("course_lookup", {"q": "CSE 100"}, use_cache=False)
        finally:
            reset_telemetry_sink(token)

    asyncio.run(main())

    assert collector.signals[0] == ToolCallStarted(tool_name="course_lookup")
    finished = collector.signals[1]
    assert isinstance(finished, ToolCallFinished)
    assert finished.tool_name == "course_lookup"
    assert finished.success is True
    assert isinstance(finished.duration_ms, float)


def test_tool_manager_publishes_failure_for_missing_tool():
    from mcp.tool_manager import MCPToolManager

    manager = MCPToolManager(api_key="test-key")
    collector = _Collector()

    async def main():
        token = set_telemetry_sink(collector)
        try:
            return await manager.call("no_such_tool", {}, use_cache=False)
        finally:
            reset_telemetry_sink(token)

    result = asyncio.run(main())
    assert result.success is False
    assert collector.signals[0] == ToolCallStarted(tool_name="no_such_tool")
    finished = collector.signals[1]
    assert isinstance(finished, ToolCallFinished)
    assert finished.success is False
