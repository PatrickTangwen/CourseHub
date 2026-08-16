"""course_lookup MCP 工具：Course Index 的结构化查询入口。

注册进现有 MCPToolManager 后自动获得熔断 / TTL 缓存 / 监控统计。
铁律（ADR-0001）：名额、时间、GPA 等精确数字只来自本工具的结果；
所有带名额数字的 section 结果都含 availability_timestamp 与 term。

本模块顶层只依赖 stdlib + coursedata（不 import anthropic）；
Tool 数据类在 register_course_lookup 内部延迟导入 —— 调用方传入的
tool_manager 实例本身已加载了 mcp.tool_manager，不会引入新依赖。
"""
import logging
from typing import Any, Dict, Optional

from coursedata.normalize import normalize_term
from coursedata.query import CourseIndex

logger = logging.getLogger(__name__)

FALLBACK_MESSAGE = "课程数据索引暂不可用，请稍后重试 / Course index temporarily unavailable."

_ACTIONS = ("course", "sections", "instructor", "grades", "search")

_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "action": {
            "type": "string",
            "enum": list(_ACTIONS),
            "description": "course=课程+sections | sections=仅sections | instructor=按教授查 | grades=成绩历史 | search=按条件筛课",
        },
        "course_code": {"type": "string", "description": "课程代码，如 CSE 100 / cse100"},
        "term": {"type": "string", "description": "学期代码或自然语言，如 FA26 / Fall 2026 / 2026 秋"},
        "instructor": {"type": "string", "description": "教授姓名（子串，大小写不敏感）"},
        "subject": {"type": "string", "description": "科目代码，如 CSE"},
        "units": {"type": "number", "description": "学分数，如 4"},
    },
    "required": ["action"],
}


def _require(params: Dict[str, Any], field: str, action: str) -> Any:
    value = params.get(field)
    if value is None or (isinstance(value, str) and not value.strip()):
        raise ValueError(f"action={action} 需要参数 {field} / requires parameter {field}")
    return value


def register_course_lookup(tool_manager, index_path) -> None:
    """把 course_lookup 工具注册到给定的 MCPToolManager。"""
    from mcp.tool_manager import Tool  # 延迟导入：避免本模块顶层依赖 anthropic

    index_path = str(index_path)

    def handler(params: Dict[str, Any], context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        action = params.get("action")
        if action not in _ACTIONS:
            raise ValueError(f"未知 action: {action!r}，可选 {list(_ACTIONS)}")

        raw_term = params.get("term")
        term = (normalize_term(raw_term) or raw_term.strip()) if raw_term else None

        # 每次调用独立打开连接：handler 在线程池中执行，SQLite 连接不能跨线程共享。
        with CourseIndex(index_path) as index:
            if action == "course":
                code = _require(params, "course_code", action)
                results = index.lookup_course(code, term=term)
            elif action == "sections":
                code = _require(params, "course_code", action)
                results = index.sections_for(code, term=term)
            elif action == "instructor":
                name = _require(params, "instructor", action)
                results = index.instructor_courses(name, term=term)
            elif action == "grades":
                code = _require(params, "course_code", action)
                results = index.grade_history(code)
            else:  # search
                results = index.search_courses(
                    subject=params.get("subject"),
                    units=params.get("units"),
                    term=term,
                    limit=50,
                )

        return {
            "action": action,
            "term": term,
            "count": len(results),
            "results": results,
            "note": "静态快照数据；名额数字以各 section 的 availability_timestamp 为准，非实时。",
        }

    def fallback(params: Dict[str, Any], context: Optional[Dict[str, Any]], error: str) -> Dict[str, Any]:
        return {"fallback": True, "message": FALLBACK_MESSAGE, "error": error}

    tool_manager.register(Tool(
        name="course_lookup",
        description=(
            "查询课程结构化索引（Course Index）：课程/学期的 sections、上课时间地点、"
            "名额、授课教授、成绩历史、按条件筛课。精确数字（名额/时间/GPA）以本工具结果为准。"
            " / Structured Course Index lookup: sections, schedule, seats, instructors, "
            "grade history, course search. Exact numbers must come from these results."
        ),
        handler=handler,
        schema=_SCHEMA,
        cache_ttl=600.0,   # 静态快照，放心缓存
        timeout_s=10.0,
        fallback=fallback,
    ))
    logger.info(f"course_lookup 已注册（索引: {index_path}）")
