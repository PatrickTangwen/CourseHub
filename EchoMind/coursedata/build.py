"""快照 → 派生产物（纯 stdlib）。

输入：SunGrid 发布的学期快照 JSON（ucsd-course-data/…/catalogs/public/*.json）。
输出（全部为派生产物，快照更新时整体重建，绝不手改）：
  1. build_index()            → SQLite Course Index（terms/courses/sections/grade_records）
  2. build_dictionaries()     → 科目 / 教授词典
  3. render_knowledge_docs()  → 每门唯一课程一篇的 Knowledge Doc（语义检索侧）

Schema 陷阱（真实数据验证过）：
  - FA26 来自 TSS（raw.source="ucsd_tss"）：有 available_seats / capacity_kind /
    availability_verified / availability_timestamp；meeting_type 是 "Package" /
    "lecture" / "SE" / "IN" 等混合词汇。
  - 其余 14 学期来自 Schedule of Classes（raw.source="ucsd_schedule_of_classes"）：
    完全没有上述名额校验字段（落库为 NULL，绝不编造）；meeting_type 是
    "Lecture" / "Discussion" / "Independent Study" 等全称。
  - 归一化后的 meeting_type 存 `meeting_type` 列，原始值存 `meeting_type_raw`。
"""
import json
import pathlib
import re
import sqlite3
from typing import Any, Dict, Iterable, List, Optional, Sequence, Union

from coursedata.normalize import term_sort_key

PathLike = Union[str, pathlib.Path]

NO_DESCRIPTION_PLACEHOLDER = "官方目录无课程描述 / No official catalog description."
MAX_DOC_CHARS = 1800
COURSE_INDEX_SCHEMA_VERSION = 2

# ── meeting_type 归一化 ───────────────────────────────────────────────────────

# key 一律小写。覆盖两个源的全部已观测词汇（TSS 代码 + SoC 全称）。
_MEETING_TYPE_MAP = {
    "le": "lecture", "lecture": "lecture",
    "di": "discussion", "discussion": "discussion",
    "la": "lab", "lab": "lab", "laboratory": "lab",
    "se": "seminar", "seminar": "seminar",
    "in": "independent_study", "independent study": "independent_study",
    "fi": "final_exam", "final": "final_exam", "final exam": "final_exam",
    "package": "package",
    "tu": "tutorial", "tutorial": "tutorial",
    "pr": "practicum", "practicum": "practicum",
    "st": "studio", "studio": "studio",
    "cl": "clinical_clerkship", "clinical clerkship": "clinical_clerkship",
    "co": "conference", "conference": "conference",
    "fw": "fieldwork", "fieldwork": "fieldwork",
    "ac": "activity", "activity": "activity",
    "fm": "film", "film": "film",
    "ot": "other", "other": "other", "other additional meeting": "other",
}


def normalize_meeting_type(raw: Optional[str]) -> Optional[str]:
    """归一化 meeting_type；未知值小写直通（空白折叠为下划线）。"""
    if raw is None:
        return None
    key = re.sub(r"\s+", " ", raw.strip()).lower()
    if not key:
        return None
    return _MEETING_TYPE_MAP.get(key, key.replace(" ", "_"))


# ── 快照读取 ──────────────────────────────────────────────────────────────────

_TERM_FROM_FILENAME_RE = re.compile(r"(?i)^(FA|WI|SP|S[123])(\d{2})")


def infer_term_from_filename(path: PathLike) -> str:
    """快照顶层没有 term 字段，从文件名推断："FA26.json" / "FA26-mini.json" → "FA26"。"""
    stem = pathlib.Path(path).stem
    m = _TERM_FROM_FILENAME_RE.match(stem)
    if not m:
        raise ValueError(f"无法从文件名推断学期代码: {path}")
    return (m.group(1) + m.group(2)).upper()


def _load_snapshot(path: PathLike) -> Dict[str, Any]:
    with open(path, encoding="utf-8") as f:
        snap = json.load(f)
    snap["_term"] = infer_term_from_filename(path)
    return snap


def _iter_snapshots(snapshot_paths: Sequence[PathLike]) -> Iterable[Dict[str, Any]]:
    for path in snapshot_paths:
        yield _load_snapshot(path)


# ── SQLite Course Index ───────────────────────────────────────────────────────

_SCHEMA = """
DROP TABLE IF EXISTS terms;
DROP TABLE IF EXISTS courses;
DROP TABLE IF EXISTS sections;
DROP TABLE IF EXISTS grade_records;

CREATE TABLE terms (
    term         TEXT PRIMARY KEY,
    term_label   TEXT,
    generated_at TEXT,
    date_start   TEXT,
    date_end     TEXT
);

CREATE TABLE courses (
    term                TEXT NOT NULL,
    course_id           TEXT NOT NULL,
    subject             TEXT NOT NULL,
    course_number       TEXT NOT NULL,
    display_course_code TEXT,
    title               TEXT,
    units               TEXT,
    description         TEXT,
    prerequisites_text  TEXT,
    restrictions_text   TEXT,
    catalog_url         TEXT,
    ge_matches_json     TEXT,
    PRIMARY KEY (term, course_id)
);

CREATE TABLE sections (
    term                   TEXT NOT NULL,
    section_id             TEXT NOT NULL,
    course_id              TEXT NOT NULL,
    section_code           TEXT,
    meeting_type_raw       TEXT,
    meeting_type           TEXT,
    instructors_json       TEXT,
    enrolled               INTEGER,
    capacity               INTEGER,
    available_seats        INTEGER,
    capacity_kind          TEXT,
    waitlist_count         INTEGER,
    availability_verified  INTEGER,
    availability_timestamp TEXT,
    meetings_json          TEXT,
    PRIMARY KEY (term, section_id)
);

CREATE TABLE grade_records (
    term                 TEXT NOT NULL,
    target_subject       TEXT NOT NULL,
    target_course_number TEXT NOT NULL,
    subject              TEXT NOT NULL,
    course_number        TEXT NOT NULL,
    year                 TEXT,
    quarter              TEXT,
    instructor           TEXT,
    gpa                  REAL,
    a REAL, b REAL, c REAL, d REAL, f REAL, w REAL, p REAL, np REAL,
    title                TEXT,
    matched_via          TEXT
);

CREATE INDEX idx_courses_code   ON courses (subject, course_number);
CREATE INDEX idx_sections_course ON sections (term, course_id);
CREATE INDEX idx_grades_code    ON grade_records (target_subject, target_course_number);
PRAGMA user_version = 2;
"""


def build_index(snapshot_paths: Sequence[PathLike], db_path: PathLike) -> Dict[str, int]:
    """从快照构建 SQLite Course Index。幂等：每次 DROP/CREATE 全量重建。

    返回计数：{"terms", "courses", "sections", "grade_records"}。
    """
    db_path = pathlib.Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(str(db_path))
    try:
        conn.executescript(_SCHEMA)
        counts = {"terms": 0, "courses": 0, "sections": 0, "grade_records": 0}

        for snap in _iter_snapshots(snapshot_paths):
            term = snap["_term"]
            date_range = snap.get("term_date_range") or {}
            # OR REPLACE：同名学期文件（如 FA26.json 与 FA26-mini.json 同目录）
            # 不应让构建带着半成品库崩溃，后写者覆盖并继续。
            conn.execute(
                "INSERT OR REPLACE INTO terms VALUES (?,?,?,?,?)",
                (term, snap.get("term_label"), snap.get("generated_at"),
                 date_range.get("start"), date_range.get("end")),
            )
            counts["terms"] += 1

            for course in snap.get("courses") or []:
                ge = course.get("ge_matches")
                conn.execute(
                    "INSERT INTO courses VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        term,
                        course["course_id"],
                        course["subject"],
                        course["course_number"],
                        course.get("display_course_code"),
                        course.get("title"),
                        course.get("units"),
                        course.get("description"),
                        course.get("prerequisites_text"),
                        course.get("restrictions_text"),
                        course.get("catalog_url"),
                        json.dumps(ge, ensure_ascii=False) if ge else None,
                    ),
                )
                counts["courses"] += 1

                for sec in course.get("sections") or []:
                    verified = sec.get("availability_verified")
                    conn.execute(
                        "INSERT INTO sections VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        (
                            term,
                            sec["section_id"],
                            sec.get("course_id") or course["course_id"],
                            sec.get("section_code"),
                            sec.get("meeting_type"),
                            normalize_meeting_type(sec.get("meeting_type")),
                            json.dumps(sec.get("instructors") or [], ensure_ascii=False),
                            sec.get("enrolled"),
                            sec.get("capacity"),
                            sec.get("available_seats"),
                            sec.get("capacity_kind"),
                            sec.get("waitlist_count"),
                            None if verified is None else int(bool(verified)),
                            sec.get("availability_timestamp"),
                            json.dumps(sec.get("meetings") or [], ensure_ascii=False),
                        ),
                    )
                    counts["sections"] += 1

                for rec in course.get("grade_archive_records") or []:
                    conn.execute(
                        "INSERT INTO grade_records VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        (
                            term,
                            course["subject"],
                            course["course_number"],
                            rec.get("subject") or course["subject"],
                            rec.get("course") or course["course_number"],
                            rec.get("year"),
                            rec.get("quarter"),
                            rec.get("instructor"),
                            rec.get("gpa"),
                            rec.get("a"), rec.get("b"), rec.get("c"), rec.get("d"),
                            rec.get("f"), rec.get("w"), rec.get("p"), rec.get("np"),
                            rec.get("title"),
                            rec.get("matched_via"),
                        ),
                    )
                    counts["grade_records"] += 1

        conn.commit()
        return counts
    finally:
        conn.close()


# ── 词典 ──────────────────────────────────────────────────────────────────────

def build_dictionaries(snapshot_paths: Sequence[PathLike]) -> Dict[str, List[str]]:
    """导出实体词典：{"subjects": [...], "instructors": [...]}（排序去重）。

    subjects 取自快照 courses 的 subject 字段（实际有课的科目）；
    instructors 合并 sections[].instructors 与 grade_archive_records[].instructor
    的两种书写格式（TSS "First Last" / SoC & 成绩档案 "Last, First"）。
    """
    subjects: set = set()
    instructors: set = set()
    for snap in _iter_snapshots(snapshot_paths):
        for course in snap.get("courses") or []:
            subjects.add(course["subject"])
            for sec in course.get("sections") or []:
                for name in sec.get("instructors") or []:
                    if name and name.strip():
                        instructors.add(name.strip())
            for rec in course.get("grade_archive_records") or []:
                name = rec.get("instructor")
                if name and name.strip():
                    instructors.add(name.strip())
    return {"subjects": sorted(subjects), "instructors": sorted(instructors)}


# ── Knowledge Docs（语义检索侧）───────────────────────────────────────────────

def _format_ge(ge_matches: List[Any]) -> str:
    parts = []
    for item in ge_matches:
        if isinstance(item, str):
            parts.append(item)
        else:
            parts.append(json.dumps(item, ensure_ascii=False))
    return ", ".join(parts)


def render_knowledge_docs(snapshot_paths: Sequence[PathLike]) -> List[Dict[str, Any]]:
    """每门唯一课程（subject + course_number）一篇 Knowledge Doc。

    内容取最新开课学期（term_sort_key 最大者）的字段；短行 + 换行分隔，
    规避 chunker 对英文长段按中文句号切块失效的问题；每篇 ≤ ~1800 字符
    （超长 description 截断加省略号）。
    """
    # (subject, course_number) → {"terms": [term, ...], "course": 最新学期的 course dict}
    merged: Dict[tuple, Dict[str, Any]] = {}
    for snap in _iter_snapshots(snapshot_paths):
        term = snap["_term"]
        for course in snap.get("courses") or []:
            key = (course["subject"], course["course_number"])
            entry = merged.setdefault(key, {"terms": [], "course": None, "term": None})
            entry["terms"].append(term)
            if entry["term"] is None or term_sort_key(term) > term_sort_key(entry["term"]):
                entry["term"] = term
                entry["course"] = course

    docs: List[Dict[str, Any]] = []
    for (subject, number) in sorted(merged):
        entry = merged[(subject, number)]
        course = entry["course"]
        terms_offered = sorted(set(entry["terms"]), key=term_sort_key)

        code = f"{subject} {number}"
        title_line = f"{code}: {course.get('title') or '(untitled)'}"

        description = course.get("description") or NO_DESCRIPTION_PLACEHOLDER
        lines: List[str] = [title_line]
        if course.get("units"):
            lines.append(f"Units: {course['units']}")
        desc_index = len(lines)
        lines.append(description)
        if course.get("prerequisites_text"):
            lines.append(f"Prerequisites: {course['prerequisites_text']}")
        if course.get("restrictions_text"):
            lines.append(f"Restrictions: {course['restrictions_text']}")
        if course.get("ge_matches"):
            lines.append(f"GE: {_format_ge(course['ge_matches'])}")
        lines.append(f"Offered terms: {', '.join(terms_offered)}")

        content = "\n".join(lines)
        if len(content) > MAX_DOC_CHARS:
            overflow = len(content) - MAX_DOC_CHARS
            keep = max(len(description) - overflow - 1, 0)
            lines[desc_index] = description[:keep].rstrip() + "…"
            content = "\n".join(lines)
        if len(content) > MAX_DOC_CHARS:
            # 描述以外的字段（如超长先修文本）导致压缩饱和时的最终硬上限
            content = content[: MAX_DOC_CHARS - 1].rstrip() + "…"

        docs.append({
            "title": title_line,
            "content": content,
            "metadata": {
                "subject": subject,
                "course_number": number,
                "terms_offered": ",".join(terms_offered),
            },
        })
    return docs
