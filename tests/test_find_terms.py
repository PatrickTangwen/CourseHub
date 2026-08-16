"""find_terms：自由文本学期抽取的确定性测试。

关键回归：中文相邻（\b 失配）与课号尾数字误吞（"CSE 100秋季" ≠ FA00）。
"""
from coursedata.normalize import find_terms


def test_code_form_plain():
    assert find_terms("FA26 有哪些课") == ["FA26"]


def test_code_form_cjk_adjacent():
    assert find_terms("FA26的课") == ["FA26"]
    assert find_terms("FA26的CSE100还有位置吗") == ["FA26"]


def test_code_form_lowercase_and_summer():
    assert find_terms("s126 和 wi25 都想看看") == ["S126", "WI25"]


def test_code_form_not_inside_course_code():
    # CS126 是课号，不是学期 S126
    assert find_terms("CS126 怎么样") == []


def test_english_quarter_year():
    assert find_terms("courses in Fall 2026") == ["FA26"]
    assert find_terms("spring of 26, maybe winter 2025 too") == ["SP26", "WI25"]


def test_english_summer_session():
    assert find_terms("summer session 1 2026") == ["S126"]
    assert find_terms("Summer 2 of 2025") == ["S225"]


def test_chinese_year_quarter():
    assert find_terms("2026 秋有开吗") == ["FA26"]
    assert find_terms("26秋季和 2025 春") == ["FA26", "SP25"]


def test_course_number_digits_not_eaten():
    # "CSE 100秋季"：课号尾数字不得被解析成学期年份（回归 FA00）
    assert find_terms("CSE 100秋季有开吗") == []


def test_dedup_and_order():
    assert find_terms("FA26 fall 2026 和 2026 秋") == ["FA26"]


def test_empty():
    assert find_terms("") == []
    assert find_terms("这门课讲什么") == []
