"""课程代码与学期的归一化（纯 stdlib）。

约定：
  - 课程代码 canonical 形式为 "SUBJ NUM"，如 "CSE 100"、"MATH 20C"、"AAS 10R"。
    科目 2–4 个字母，编号 1–3 位数字 + 至多 2 个尾字母。
  - 学期 canonical 形式为 SunGrid 学期代码：FA26 / WI25 / SP25 / S126 / S225 / S324 …
  - 相对表述（"下学期"）由调用方解析为 ACTIVE_PLANNING_TERM，本模块不处理。
"""
import re
from typing import List, Optional, Tuple

# 数据为 2026-08 静态快照，Active Planning Term 固定为 FA26。
ACTIVE_PLANNING_TERM = "FA26"

# ── 课程代码 ──────────────────────────────────────────────────────────────────

# 科目 2-4 字母；编号 1-3 位数字 + 0-2 尾字母。
# 用显式 lookaround 代替 \b：中文字符在 \w 内，"上cse100和" 这类相邻中文会让 \b 失配。
_COURSE_CODE_RE = re.compile(
    r"(?<![A-Za-z0-9])"
    r"([A-Za-z]{2,4})"          # subject
    r"[\s\-–_]*"                # 可选分隔符（空格 / 连字符）
    r"(\d{1,3})([A-Za-z]{0,2})"  # number + suffix
    r"(?![A-Za-z0-9])"
)

# 学期代码形如 FA26 / WI25 / SP25 会被上面的正则误认成 "FA 26"，需排除。
_TERM_LIKE_SUBJECTS = {"FA", "WI", "SP"}


def _canonical(subject: str, digits: str, suffix: str) -> str:
    return f"{subject.upper()} {digits}{suffix.upper()}"


def _is_term_like(subject: str, digits: str, suffix: str) -> bool:
    return subject.upper() in _TERM_LIKE_SUBJECTS and len(digits) == 2 and not suffix


def normalize_course_code(text: str) -> Optional[str]:
    """把 "cse100" / "CSE-100" / "cse 100" 归一化为 "CSE 100"；无法解析返回 None。"""
    if not text:
        return None
    m = _COURSE_CODE_RE.fullmatch(text.strip())
    if not m:
        return None
    subject, digits, suffix = m.groups()
    if _is_term_like(subject, digits, suffix):
        return None
    return _canonical(subject, digits, suffix)


def find_course_codes(text: str) -> List[str]:
    """从自由文本中提取全部课程代码（canonical 形式，按出现顺序去重）。"""
    if not text:
        return []
    found: List[str] = []
    for m in _COURSE_CODE_RE.finditer(text):
        subject, digits, suffix = m.groups()
        if _is_term_like(subject, digits, suffix):
            continue
        code = _canonical(subject, digits, suffix)
        if code not in found:
            found.append(code)
    return found


# ── 学期 ──────────────────────────────────────────────────────────────────────

_TERM_CODE_RE = re.compile(r"(?i)^(FA|WI|SP|S[123])(\d{2})$")

# (正则, 学期前缀)。顺序重要：先匹配更长/更具体的表达。
_QUARTER_PATTERNS: Tuple[Tuple[re.Pattern, str], ...] = (
    (re.compile(r"(?i)special\s+summer|summer\s+session\s*(?:iii|3)\b"), "S3"),
    (re.compile(r"(?i)summer\s+session\s*(?:ii|2)\b"), "S2"),
    (re.compile(r"(?i)summer\s+session\s*(?:i|1|one)\b"), "S1"),
    (re.compile(r"(?i)\bfall\b|\bautumn\b|秋"), "FA"),
    (re.compile(r"(?i)\bwinter\b|冬"), "WI"),
    (re.compile(r"(?i)\bspring\b|春"), "SP"),
)

_YEAR_RE = re.compile(r"(?:19|20)(\d{2})")


def normalize_term(text: str) -> Optional[str]:
    """把学期表述归一化为学期代码；无法识别返回 None。

    支持：
      - 合法代码直通（大小写不敏感）："FA26" / "wi25" / "S126"
      - 英文："Fall 2026" / "Winter 2025" / "Summer Session 1 2026" / "Special Summer Session 2026"
      - 中文："2026 秋" / "2026秋季" / "2026年秋" / "2025 冬" / "2025 春"
    """
    if not text:
        return None
    text = text.strip()

    m = _TERM_CODE_RE.match(text)
    if m:
        return (m.group(1) + m.group(2)).upper()

    year_m = _YEAR_RE.search(text)
    if not year_m:
        return None
    yy = year_m.group(1)

    for pattern, prefix in _QUARTER_PATTERNS:
        if pattern.search(text):
            return prefix + yy
    return None


# ── 学期抽取（自由文本）───────────────────────────────────────────────────────

# 代码形（FA26 / s126）：lookaround 容忍相邻中文；排除 CS126 这类课号内嵌。
_TERM_CODE_FIND_RE = re.compile(r"(?i)(?<![A-Za-z0-9])(FA|WI|SP|S[123])(\d{2})(?![A-Za-z0-9])")
_EN_QUARTER_FIND_RE = re.compile(
    r"(?i)(?<![A-Za-z])(fall|autumn|winter|spring)(?![A-Za-z])[\s,]*(?:of\s*)?((?:20)?\d{2})(?!\d)"
)
_EN_SUMMER_FIND_RE = re.compile(
    r"(?i)(?<![A-Za-z])summer\s*(?:session\s*)?([123])\s*(?:of\s*)?((?:20)?\d{2})(?!\d)"
)
# 左侧 (?<!\d) 防止课号尾数字被吞（"CSE 100秋季" 不得解析出 FA00）。
_CN_QUARTER_FIND_RE = re.compile(r"(?<!\d)(?:20)?(\d{2})\s*年?\s*(秋|冬|春)(?:季|天)?")
_EN_QUARTER_PREFIX = {"fall": "FA", "autumn": "FA", "winter": "WI", "spring": "SP"}
_CN_QUARTER_PREFIX = {"秋": "FA", "冬": "WI", "春": "SP"}


def find_terms(text: str) -> List[str]:
    """从自由文本中提取全部学期代码（canonical 形式，按出现顺序去重）。

    覆盖代码形（FA26 / s126，容忍相邻中文）、英文季节+年份（Fall 2026 /
    summer session 1 2026）、中文年份+季节（2026 秋 / 26秋季）。
    相对表述（"下学期"）由调用方解析为 ACTIVE_PLANNING_TERM，本函数不处理。
    """
    if not text:
        return []
    found: List[str] = []

    def _add(code: str) -> None:
        if code not in found:
            found.append(code)

    for m in _TERM_CODE_FIND_RE.finditer(text):
        _add((m.group(1) + m.group(2)).upper())
    for m in _EN_QUARTER_FIND_RE.finditer(text):
        _add(_EN_QUARTER_PREFIX[m.group(1).lower()] + m.group(2)[-2:])
    for m in _EN_SUMMER_FIND_RE.finditer(text):
        _add(f"S{m.group(1)}{m.group(2)[-2:]}")
    for m in _CN_QUARTER_FIND_RE.finditer(text):
        _add(_CN_QUARTER_PREFIX[m.group(2)] + m.group(1))
    return found


# ── 学期排序 ──────────────────────────────────────────────────────────────────

# 同一年内的时间顺序：WI < SP < S1 < S2 < S3 < FA
QUARTER_ORDER = {"WI": 0, "SP": 1, "S1": 2, "S2": 3, "S3": 4, "FA": 5}
_QUARTER_ORDER = QUARTER_ORDER  # 兼容旧名


def term_sort_key(term: str) -> Tuple[int, int]:
    """学期代码 → (年份, 季度序) 排序键；FA26 > S326 > … > WI26 > FA25。

    无法解析的学期排在最前（(-1, -1)），不抛异常。
    """
    m = _TERM_CODE_RE.match(term or "")
    if not m:
        return (-1, -1)
    quarter = m.group(1).upper()
    year = 2000 + int(m.group(2))
    return (year, _QUARTER_ORDER[quarter])
