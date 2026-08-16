"""
阶段事件槽(stage-event sink)。

/chat/stream 在请求上下文里通过 set_stage_sink 安装一个异步回调;
pipeline 深处(orchestrator 路由决策、tool_manager 工具调用)用
emit_stage 透出阶段事件,由 SSE 端点转发给前端
(协议见 docs/specs/coursehub-frontend.md §3.1)。

用 ContextVar 承载:并发请求之间互不串扰;未安装 sink 时 emit_stage
是空操作,非流式路径与既有测试零受影响。事件透出永不干扰主链路——
sink 抛错只记日志。
"""
import logging
from contextvars import ContextVar, Token
from typing import Any, Awaitable, Callable, Dict, Optional

logger = logging.getLogger(__name__)

StageSink = Callable[[str, Dict[str, Any]], Awaitable[None]]

_sink: ContextVar[Optional[StageSink]] = ContextVar("coursehub_stage_sink", default=None)


def set_stage_sink(sink: StageSink) -> Token:
    return _sink.set(sink)


def reset_stage_sink(token: Token) -> None:
    _sink.reset(token)


async def emit_stage(event: str, payload: Dict[str, Any]) -> None:
    sink = _sink.get()
    if sink is None:
        return
    try:
        await sink(event, payload)
    except Exception:  # pragma: no cover - 防御性:事件失败不拖垮主链路
        logger.debug("阶段事件透出失败: %s", event, exc_info=True)
