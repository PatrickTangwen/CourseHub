"""coursedata.normalize 的确定性测试：课程代码归一化 + 学期归一化。"""
import pytest

from coursedata.normalize import (
    ACTIVE_PLANNING_TERM,
    find_course_codes,
    normalize_course_code,
    normalize_term,
    term_sort_key,
)


# ── normalize_course_code ─────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "raw, expected",
    [
        ("cse100", "CSE 100"),
        ("CSE-100", "CSE 100"),
        ("cse 100", "CSE 100"),
        ("CSE 100", "CSE 100"),
        ("  cse   100  ", "CSE 100"),
        ("CSE 8A", "CSE 8A"),
        ("cse8a", "CSE 8A"),
        ("MATH 20C", "MATH 20C"),
        ("math20c", "MATH 20C"),
        ("AAS 10R", "AAS 10R"),
        ("aip 197EX", "AIP 197EX"),
    ],
)
def test_normalize_course_code_valid(raw, expected):
    assert normalize_course_code(raw) == expected


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "   ",
        "100",            # 只有数字
        "CSE",            # 只有科目
        "C 100",          # 科目至少 2 个字母
        "ABCDE 100",      # 科目最多 4 个字母
        "CSE 1000",       # 数字最多 3 位
        "CSE 100ABC",     # 后缀最多 2 个字母
        "hello world",
        "FA26",           # 学期代码不是课程代码
        "wi25",
    ],
)
def test_normalize_course_code_invalid(raw):
    assert normalize_course_code(raw) is None


def test_find_course_codes_in_free_text():
    assert find_course_codes("我想上cse100和CSE-101") == ["CSE 100", "CSE 101"]


def test_find_course_codes_excludes_term_codes():
    # "FA26" 是学期代码，不能被误识别为课程代码
    assert find_course_codes("FA26 的 MATH 20C 什么时候上课?") == ["MATH 20C"]


def test_find_course_codes_dedup_preserves_order():
    text = "Compare MATH 20C with cse 8A, then math20c again."
    assert find_course_codes(text) == ["MATH 20C", "CSE 8A"]


def test_find_course_codes_none_found():
    assert find_course_codes("你好，今天天气怎么样？") == []


# ── normalize_term ────────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "raw, expected",
    [
        # 有效代码直通（大小写不敏感）
        ("FA26", "FA26"),
        ("fa26", "FA26"),
        ("WI25", "WI25"),
        ("SP25", "SP25"),
        ("S126", "S126"),
        ("s225", "S225"),
        ("S324", "S324"),
        # 英文自然语言
        ("Fall 2026", "FA26"),
        ("fall 2026", "FA26"),
        ("Winter 2025", "WI25"),
        ("Spring 2026", "SP26"),
        ("Summer Session 1 2026", "S126"),
        ("Summer Session I 2026", "S126"),
        ("Summer Session 2 2025", "S225"),
        ("Special Summer Session 2026", "S326"),
        # 中文自然语言
        ("2026 秋", "FA26"),
        ("2026秋季", "FA26"),
        ("2026年秋季", "FA26"),
        ("2025 冬", "WI25"),
        ("2025 春", "SP25"),
    ],
)
def test_normalize_term_valid(raw, expected):
    assert normalize_term(raw) == expected


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "下学期",          # 相对表述由调用方解析，这里返回 None
        "next quarter",
        "FA2026",          # 不是合法代码
        "S426",            # 只有 S1/S2/S3
        "garbage",
        "2026",            # 只有年份
        "秋",              # 只有季度
    ],
)
def test_normalize_term_invalid(raw):
    assert normalize_term(raw) is None


def test_active_planning_term():
    assert ACTIVE_PLANNING_TERM == "FA26"


def test_term_sort_key_ordering():
    # 年份优先，同年内 WI < SP < S1 < S2 < S3 < FA
    ordered = ["FA24", "WI25", "SP25", "S125", "S225", "S325", "FA25",
               "WI26", "SP26", "S126", "S226", "S326", "FA26"]
    assert sorted(ordered[::-1], key=term_sort_key) == ordered
