"""CourseHub 课程数据包（纯 stdlib，勿引入第三方依赖）。

模块：
  - normalize: 课程代码 / 学期归一化
  - build:     快照 → SQLite Course Index / Knowledge Docs / 词典
  - query:     CourseIndex 结构化查询（精确数字的唯一来源，ADR-0001）

本包被离线预处理脚本（tools/build_course_data.py）和 MCP 工具
（mcp/course_lookup.py）共用；测试运行在无 anthropic/chromadb 的系统
Python 上，因此这里绝不能 import 后端框架模块。
"""
from coursedata.normalize import (  # noqa: F401
    ACTIVE_PLANNING_TERM,
    find_course_codes,
    normalize_course_code,
    normalize_term,
    term_sort_key,
)
