"""coursedata.build / coursedata.query 的确定性测试。

夹具是从真实快照抽取的迷你切片：
  - FA26-mini.json（TSS 源）：CSE 100（Package + 名额 + 32 条成绩记录）、
    ECE 111（Package）、ANAR 111（裸 "lecture" section）
  - S326-mini.json（Schedule of Classes 源）：ECE 111（Discussion）、
    MGT 453（Lecture）、AIP 197EX（units/description 为 null）

所有断言都是精确值（ADR-0001：精确数字只来自 Course Index）。
"""
import json
import pathlib

import pytest

from coursedata.build import (
    build_dictionaries,
    build_index,
    normalize_meeting_type,
    render_knowledge_docs,
)
from coursedata.query import CourseIndex

FIXTURES = pathlib.Path(__file__).parent / "fixtures"
SNAPSHOTS = [FIXTURES / "FA26-mini.json", FIXTURES / "S326-mini.json"]


@pytest.fixture(scope="module")
def index(tmp_path_factory):
    db_path = tmp_path_factory.mktemp("coursehub") / "course_index.sqlite"
    build_index(SNAPSHOTS, db_path)
    # 幂等：重复构建不报错、不重复数据
    build_index(SNAPSHOTS, db_path)
    idx = CourseIndex(db_path)
    yield idx
    idx.close()


# ── meeting_type 归一化 ───────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "raw, expected",
    [
        # TSS 词汇
        ("Package", "package"),
        ("lecture", "lecture"),
        ("discussion", "discussion"),
        ("LAB", "lab"),
        ("SE", "seminar"),
        ("IN", "independent_study"),
        ("TU", "tutorial"),
        ("PR", "practicum"),
        ("ST", "studio"),
        ("CL", "clinical_clerkship"),
        ("CO", "conference"),
        # Schedule of Classes 词汇
        ("Lecture", "lecture"),
        ("Discussion", "discussion"),
        ("Laboratory", "lab"),
        ("Seminar", "seminar"),
        ("Independent Study", "independent_study"),
        ("Fieldwork", "fieldwork"),
        # 原始代码
        ("LE", "lecture"),
        ("DI", "discussion"),
        ("LA", "lab"),
        ("FI", "final_exam"),
        # 未知值：小写直通（空白折叠为下划线）
        ("IT", "it"),
        ("SA", "sa"),
        ("Other Additional Meeting", "other"),
        (None, None),
    ],
)
def test_normalize_meeting_type(raw, expected):
    assert normalize_meeting_type(raw) == expected


# ── 索引构建 ──────────────────────────────────────────────────────────────────

def test_terms_table(index):
    terms = index.terms()
    assert {t["term"] for t in terms} == {"FA26", "S326"}
    fa26 = next(t for t in terms if t["term"] == "FA26")
    assert fa26["term_label"] == "Fall 2026"
    assert fa26["generated_at"] == "2026-08-13T11:00:06.839Z"
    assert fa26["date_start"] == "2026-09-24"
    assert fa26["date_end"] == "2026-12-12"


def test_lookup_course_exact_numbers(index):
    rows = index.lookup_course("CSE 100")
    assert len(rows) == 1
    course = rows[0]
    assert course["term"] == "FA26"
    assert course["title"] == "Advanced Data Structures"
    assert course["units"] == "4"
    assert course["display_course_code"] == "CSE-100"
    assert course["catalog_url"] == "https://catalog.ucsd.edu/courses/CSE.html#cse100"

    assert len(course["sections"]) == 1
    sec = course["sections"][0]
    assert sec["term"] == "FA26"
    assert sec["section_code"] == "001-000-LE + 001-001-DI"
    assert sec["meeting_type_raw"] == "Package"
    assert sec["meeting_type"] == "package"
    assert sec["instructors"] == ["Paul Cao"]
    assert sec["enrolled"] == 100
    assert sec["capacity"] == 100
    assert sec["available_seats"] == 0
    assert sec["capacity_kind"] == "bounded"
    assert sec["waitlist_count"] is None
    assert sec["availability_verified"] == 1
    assert sec["availability_timestamp"] == "2026-08-12T16:39:36.000Z"
    # meetings 保留完整结构
    meetings = sec["meetings"]
    assert len(meetings) == 3
    assert meetings[0]["days"] == ["Monday", "Wednesday", "Friday"]
    assert meetings[0]["start_time"] == "09:00"
    assert meetings[0]["end_time"] == "09:50"
    assert meetings[0]["building"] == "JEANN"
    assert meetings[0]["room"] == "AUD"


def test_lookup_course_all_terms_most_recent_first(index):
    rows = index.lookup_course("ece111")   # 未归一化输入也能查
    assert [r["term"] for r in rows] == ["FA26", "S326"]

    fa26_sec = rows[0]["sections"][0]
    assert fa26_sec["enrolled"] == 29
    assert fa26_sec["capacity"] == 75
    assert fa26_sec["available_seats"] == 46
    assert fa26_sec["availability_timestamp"] == "2026-08-12T16:39:36.000Z"
    assert fa26_sec["instructors"] == ["Farinaz Koushanfar"]

    s326_sec = rows[1]["sections"][0]
    assert s326_sec["section_code"] == "A01"
    assert s326_sec["meeting_type_raw"] == "Discussion"
    assert s326_sec["meeting_type"] == "discussion"
    assert s326_sec["instructors"] == ["Karna, Vishal"]
    assert s326_sec["enrolled"] == 49
    assert s326_sec["capacity"] == 80
    # SoC 源没有名额校验字段：必须落为 NULL，绝不能编造
    assert s326_sec["available_seats"] is None
    assert s326_sec["capacity_kind"] is None
    assert s326_sec["availability_verified"] is None
    assert s326_sec["availability_timestamp"] is None
    assert s326_sec["waitlist_count"] == 0


def test_lookup_course_with_term_filter(index):
    rows = index.lookup_course("ECE 111", term="S326")
    assert len(rows) == 1
    assert rows[0]["term"] == "S326"


def test_lookup_course_unknown(index):
    assert index.lookup_course("CSE 999") == []
    assert index.lookup_course("not a course code") == []


def test_sections_for_soc_lecture_shape(index):
    secs = index.sections_for("MGT 453", term="S326")
    assert len(secs) == 1
    sec = secs[0]
    assert sec["meeting_type_raw"] == "Lecture"
    assert sec["meeting_type"] == "lecture"
    assert sec["enrolled"] == 26
    assert sec["capacity"] == 98
    assert sec["waitlist_count"] == 0
    assert sec["instructors"] == ["Kim, Kihoon"]


def test_sections_for_tss_bare_lecture(index):
    secs = index.sections_for("ANAR 111", term="FA26")
    assert len(secs) == 1
    sec = secs[0]
    assert sec["meeting_type_raw"] == "lecture"
    assert sec["meeting_type"] == "lecture"
    assert sec["enrolled"] == 9
    assert sec["capacity"] == 30
    assert sec["available_seats"] == 21
    assert sec["meetings"][0]["start_time"] == "12:30"
    assert sec["meetings"][0]["days"] == ["Tuesday", "Thursday"]


def test_null_units_and_description(index):
    rows = index.lookup_course("AIP 197EX")
    assert len(rows) == 1
    assert rows[0]["units"] is None
    assert rows[0]["description"] is None
    sec = rows[0]["sections"][0]
    assert sec["meeting_type_raw"] == "Seminar"
    assert sec["meeting_type"] == "seminar"
    assert sec["enrolled"] == 46
    assert sec["capacity"] == 60


def test_instructor_courses(index):
    hits = index.instructor_courses("koushanfar")
    assert len(hits) == 1
    hit = hits[0]
    assert hit["term"] == "FA26"
    assert hit["course_code"] == "ECE 111"
    assert hit["instructors"] == ["Farinaz Koushanfar"]
    assert hit["available_seats"] == 46
    assert hit["availability_timestamp"] == "2026-08-12T16:39:36.000Z"

    # SoC 格式（"姓, 名"）也能命中，大小写不敏感
    hits = index.instructor_courses("KARNA")
    assert len(hits) == 1
    assert hits[0]["term"] == "S326"
    assert hits[0]["course_code"] == "ECE 111"

    # 学期过滤
    assert index.instructor_courses("karna", term="FA26") == []

    # 教授比较可以限定到同一门课程，避免混入该教授的其他开课。
    assert len(index.instructor_courses("cao", term="FA26", course_code="CSE 100")) == 1
    assert index.instructor_courses("cao", term="FA26", course_code="ECE 111") == []


def test_instructor_grade_history_can_be_scoped_to_course(index):
    rows = index.instructor_grade_history("sahoo", course_code="CSE 100")

    assert rows
    assert all(row["target_subject"] == "CSE" for row in rows)
    assert all(row["target_course_number"] == "100" for row in rows)
    assert all("sahoo" in row["instructor"].lower() for row in rows)
    assert index.instructor_grade_history("sahoo", course_code="ECE 111") == []


def test_grade_history_exact_values(index):
    rows = index.grade_history("CSE 100")
    assert len(rows) == 32
    # 最新在前：唯一的 2026 WI 记录
    assert (rows[0]["year"], rows[0]["quarter"]) == ("26", "WI")
    assert rows[0]["instructor"] == "Sahoo, Debashis"
    assert rows[0]["gpa"] == 3.346
    # 最老在后：2015
    assert rows[-1]["year"] == "15"
    # 已知记录的精确分布值
    alvarado_fa16 = [
        r for r in rows
        if r["instructor"] == "Alvarado, Christine J." and r["year"] == "16" and r["quarter"] == "FA"
    ]
    assert len(alvarado_fa16) == 1
    assert alvarado_fa16[0]["gpa"] == 3.181
    assert alvarado_fa16[0]["a"] == 52.7
    assert alvarado_fa16[0]["b"] == 22.2
    assert alvarado_fa16[0]["w"] == 3.7

    assert len(index.grade_history("ECE 111")) == 22
    assert index.grade_history("MGT 453") == []


def test_grade_history_preserves_cross_listed_target_and_source(tmp_path):
    """Inherited Past Grades remain queryable from the target Course ID."""
    snapshot = {
        "generated_at": "2026-08-13T00:00:00Z",
        "term_label": "Fall 2026",
        "term_date_range": {"start": "2026-09-24", "end": "2026-12-12"},
        "courses": [
            {
                "course_id": "GLBH:129",
                "subject": "GLBH",
                "course_number": "129",
                "grade_archive_records": [{
                    "subject": "GLBH",
                    "course": "129",
                    "year": "21",
                    "quarter": "WI",
                    "instructor": "Csordas, Thomas J.",
                    "gpa": 3.95,
                }],
            },
            {
                "course_id": "ANSC:129",
                "subject": "ANSC",
                "course_number": "129",
                "grade_archive_records": [{
                    "subject": "GLBH",
                    "course": "129",
                    "year": "21",
                    "quarter": "WI",
                    "instructor": "Csordas, Thomas J.",
                    "gpa": 3.95,
                    "matched_via": "cross_listed",
                }],
            },
        ],
    }
    snapshot_path = tmp_path / "FA26-cross-listed.json"
    snapshot_path.write_text(json.dumps(snapshot), encoding="utf-8")
    db_path = tmp_path / "course_index.sqlite"
    build_index([snapshot_path], db_path)

    with CourseIndex(db_path) as cross_listed_index:
        target_rows = cross_listed_index.grade_history("ANSC 129")
        source_rows = cross_listed_index.grade_history("GLBH 129")

    assert len(target_rows) == 1
    assert target_rows[0]["subject"] == "GLBH"
    assert target_rows[0]["course_number"] == "129"
    assert target_rows[0]["matched_via"] == "cross_listed"
    assert len(source_rows) == 1
    assert source_rows[0]["matched_via"] is None


def test_search_courses(index):
    ece = index.search_courses(subject="ECE")
    assert [(r["term"], r["course_number"]) for r in ece] == [("FA26", "111"), ("S326", "111")]

    assert len(index.search_courses(subject="ECE", term="S326")) == 1
    assert len(index.search_courses(subject="MGT")) == 1
    assert index.search_courses(subject="CSE", term="S326") == []

    four_units_fa26 = index.search_courses(units=4, term="FA26")
    assert {r["course_number"] for r in four_units_fa26} == {"111", "100"}
    assert len(four_units_fa26) == 3  # ANAR 111, CSE 100, ECE 111

    assert len(index.search_courses(term="FA26", limit=2)) == 2


# ── 词典 ──────────────────────────────────────────────────────────────────────

def test_build_dictionaries():
    dicts = build_dictionaries(SNAPSHOTS)
    assert dicts["subjects"] == ["AIP", "ANAR", "CSE", "ECE", "MGT"]
    instructors = dicts["instructors"]
    assert instructors == sorted(instructors)
    assert len(instructors) == len(set(instructors))
    # section 教授（TSS 与 SoC 两种书写格式）
    assert "Paul Cao" in instructors
    assert "Karna, Vishal" in instructors
    assert "Brydges, Stacey" in instructors
    # 成绩记录里的教授也要进词典
    assert "Sahoo, Debashis" in instructors
    assert "Alvarado, Christine J." in instructors


# ── Knowledge Docs ────────────────────────────────────────────────────────────

def test_render_knowledge_docs():
    docs = render_knowledge_docs(SNAPSHOTS)
    # 每门唯一课程一篇：ANAR 111 / CSE 100 / ECE 111 / AIP 197EX / MGT 453
    assert len(docs) == 5
    by_key = {(d["metadata"]["subject"], d["metadata"]["course_number"]): d for d in docs}
    assert set(by_key) == {
        ("ANAR", "111"), ("CSE", "100"), ("ECE", "111"), ("AIP", "197EX"), ("MGT", "453"),
    }

    # 跨学期去重：ECE 111 的内容取最新学期（FA26），Offered terms 按时间升序列出两个学期
    ece = by_key[("ECE", "111")]
    assert ece["title"].startswith("ECE 111:")
    assert "Offered terms: S326, FA26" in ece["content"]
    assert ece["metadata"]["terms_offered"] == "S326,FA26"

    cse = by_key[("CSE", "100")]
    assert cse["title"] == "CSE 100: Advanced Data Structures"
    assert cse["content"].splitlines()[0] == "CSE 100: Advanced Data Structures"
    assert "Units: 4" in cse["content"]
    assert "Offered terms: FA26" in cse["content"]
    assert "Prerequisites:" in cse["content"]

    # 无官方描述 → 双语占位句，绝不编造
    aip = by_key[("AIP", "197EX")]
    assert "官方目录无课程描述 / No official catalog description." in aip["content"]

    for d in docs:
        assert len(d["content"]) <= 1800
        assert "Offered terms:" in d["content"]
        assert set(d["metadata"]) == {"subject", "course_number", "terms_offered"}


def test_render_knowledge_docs_truncates_long_description(tmp_path):
    snap = {
        "generated_at": "2026-08-13T00:00:00Z",
        "term_label": "Fall 2026",
        "term_date_range": {"start": "2026-09-24", "end": "2026-12-12"},
        "courses": [{
            "course_id": "XX:1",
            "subject": "XX",
            "course_number": "1",
            "display_course_code": "XX-1",
            "title": "Long Course",
            "units": "4",
            "description": "x" * 5000,
            "prerequisites_text": None,
            "restrictions_text": None,
            "catalog_url": None,
            "ge_matches": [],
            "grade_archive_records": [],
            "sections": [],
        }],
    }
    p = tmp_path / "FA26-long.json"
    p.write_text(json.dumps(snap), encoding="utf-8")
    docs = render_knowledge_docs([p])
    assert len(docs) == 1
    assert len(docs[0]["content"]) <= 1800
    assert "…" in docs[0]["content"]
    assert "Offered terms: FA26" in docs[0]["content"]
