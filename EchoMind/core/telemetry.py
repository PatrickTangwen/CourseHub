"""请求级 pipeline telemetry seam。

内核模块只发布协议无关的 typed signal；传输 adapter（当前是
``POST /chat/stream``）决定如何把 signal 映射为 SSE。ContextVar 让并发
请求隔离，未安装 adapter 时发布是空操作，telemetry 故障不影响主链路。
"""

import logging
from contextvars import ContextVar, Token
from dataclasses import dataclass
from typing import Awaitable, Callable, Optional, Union

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ToolCallStarted:
    tool_name: str


@dataclass(frozen=True)
class ToolCallFinished:
    tool_name: str
    success: bool
    duration_ms: float


TelemetrySignal = Union[ToolCallStarted, ToolCallFinished]
TelemetrySink = Callable[[TelemetrySignal], Awaitable[None]]

_sink: ContextVar[Optional[TelemetrySink]] = ContextVar(
    "coursehub_telemetry_sink",
    default=None,
)


def set_telemetry_sink(sink: TelemetrySink) -> Token:
    return _sink.set(sink)


def reset_telemetry_sink(token: Token) -> None:
    _sink.reset(token)


async def emit_telemetry(signal: TelemetrySignal) -> None:
    sink = _sink.get()
    if sink is None:
        return
    try:
        await sink(signal)
    except Exception:  # pragma: no cover - telemetry 不能拖垮主链路
        logger.debug("pipeline telemetry publish failed: %r", signal, exc_info=True)
