"""LLM response helpers shared by Anthropic-compatible providers."""
import os
from typing import Any, Iterable, List

# 推理型模型（如 DeepSeek v4）会先输出 thinking 块并消耗输出预算；
# 预算过小时 text 块为空。所有调用点共用这两个预算，环境变量可覆盖。
AGENT_MAX_TOKENS = int(os.getenv("COURSEHUB_AGENT_MAX_TOKENS", "4096"))
AUX_MAX_TOKENS = int(os.getenv("COURSEHUB_AUX_MAX_TOKENS", "2048"))


def extract_text_content(content: Iterable[Any]) -> str:
    """Return text blocks from Anthropic-style response content."""
    texts: List[str] = []
    for block in content or []:
        if isinstance(block, str):
            texts.append(block)
            continue

        block_type = getattr(block, "type", None)
        text = getattr(block, "text", None)
        if isinstance(block, dict):
            block_type = block.get("type", block_type)
            text = block.get("text", text)

        if isinstance(text, str) and (block_type in (None, "text")):
            texts.append(text)

    return "\n".join(t for t in texts if t)
