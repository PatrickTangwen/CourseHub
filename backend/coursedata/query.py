"""CourseIndex：SQLite Course Index 的结构化查询（纯 stdlib）。

铁律（ADR-0001）：名额 / 时间 / GPA 等精确数字只来自这里的查询结果，
绝不靠生成。所有包含名额数字的 section 结果都带 availability_timestamp
与 term，供回答层标注快照时间戳。
"""
import json
import pathlib
import sqlite3
import urllib.parse
from typing import Any, Dict, List, Optional, Union

from coursedata.instructors import build_instructor_name_records, normalize_instructor_name
from coursedata.normalize import QUARTER_ORDER, normalize_course_code, term_sort_key

PathLike = Union[str, pathlib.Path]

# 成绩档案年份是两位数（"16" → 2016）；<50 视为 2000 年代。
_YEAR_PIVOT = 50


def _grade_sort_key(row: Dict[str, Any]):
    try:
        year = int(row.get("year") or -1)
    except (TypeError, ValueError):
        return (-1, -1)
    if 0 <= year < _YEAR_PIVOT:
        year += 2000
    elif year >= _YEAR_PIVOT:
        year += 1900
    return (year, QUARTER_ORDER.get(row.get("quarter"), -1))


class CourseIndex:
    """打开 course_index.sqlite 的只读查询接口。所有方法返回普通 dict/list。"""

    def __init__(self, db_path: PathLike, check_same_thread: bool = True):
        # 只读 URI 打开：索引文件缺失时直接报错，而不是静默创建一个空库
        # 让"索引不可用"变成永久状态。
        resolved = pathlib.Path(db_path).resolve()
        uri = "file:" + urllib.parse.quote(resolved.as_posix(), safe=":/") + "?mode=ro"
        self._conn = sqlite3.connect(uri, uri=True, check_same_thread=check_same_thread)
        self._conn.row_factory = sqlite3.Row
        self._load_instructor_names()

    def close(self) -> None:
        self._conn.close()

    def __enter__(self) -> "CourseIndex":
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    # ── 内部工具 ──────────────────────────────────────────────────────────────

    @staticmethod
    def _split_code(course_code: str) -> Optional[tuple]:
        code = normalize_course_code(course_code or "")
        if code is None:
            return None
        subject, number = code.split(" ", 1)
        return subject, number

    @staticmethod
    def _course_dict(row: sqlite3.Row) -> Dict[str, Any]:
        d = dict(row)
        ge_json = d.pop("ge_matches_json", None)
        d["ge_matches"] = json.loads(ge_json) if ge_json else []
        return d

    @staticmethod
    def _section_dict(row: sqlite3.Row) -> Dict[str, Any]:
        d = dict(row)
        d["instructors"] = json.loads(d.pop("instructors_json") or "[]")
        d["meetings"] = json.loads(d.pop("meetings_json") or "[]")
        return d

    def _sections_of(self, term: str, course_id: str) -> List[Dict[str, Any]]:
        rows = self._conn.execute(
            "SELECT * FROM sections WHERE term = ? AND course_id = ? ORDER BY section_code, section_id",
            (term, course_id),
        ).fetchall()
        return [self._section_dict(r) for r in rows]

    def _load_instructor_names(self) -> None:
        """Load persisted aliases, deriving them for pre-v3 indexes as a fallback."""
        try:
            records = [
                dict(row)
                for row in self._conn.execute(
                    "SELECT source_name, source_key, canonical_full, family_name FROM instructor_names"
                ).fetchall()
            ]
        except sqlite3.OperationalError:
            names = set()
            for row in self._conn.execute("SELECT instructors_json FROM sections").fetchall():
                names.update(json.loads(row["instructors_json"] or "[]"))
            names.update(
                row["instructor"]
                for row in self._conn.execute(
                    "SELECT DISTINCT instructor FROM grade_records WHERE instructor IS NOT NULL"
                ).fetchall()
                if row["instructor"]
            )
            records = build_instructor_name_records(names)

        self._instructor_names = {
            row["source_key"]: (row["canonical_full"], row["family_name"])
            for row in records
        }
        self._known_instructor_full_names = {
            full_name for full_name, _ in self._instructor_names.values()
        }
        self._known_instructor_family_names = {
            family_name for _, family_name in self._instructor_names.values()
        }

    def _resolve_instructor_query(self, value: str) -> Optional[tuple]:
        records = build_instructor_name_records([value])
        if not records:
            return None
        canonical_full = records[0]["canonical_full"]
        normalized_query = normalize_instructor_name(value)
        if " " not in normalized_query and "," not in normalized_query:
            if canonical_full in self._known_instructor_family_names:
                return "family", canonical_full
        if canonical_full in self._known_instructor_full_names:
            return "full", canonical_full
        if canonical_full in self._known_instructor_family_names:
            return "family", canonical_full
        return None

    def _instructor_matches(self, mode: str, expected: str, indexed_name: str) -> bool:
        parts = self._instructor_names.get(normalize_instructor_name(indexed_name))
        if parts is None:
            fallback = build_instructor_name_records([indexed_name])
            if not fallback:
                return False
            parts = (fallback[0]["canonical_full"], fallback[0]["family_name"])
        canonical_full, family_name = parts
        return canonical_full == expected if mode == "full" else family_name == expected

    # ── 查询 API ──────────────────────────────────────────────────────────────

    def terms(self) -> List[Dict[str, Any]]:
        """全部学期（terms 表），最新在前。"""
        rows = self._conn.execute("SELECT * FROM terms").fetchall()
        out = [dict(r) for r in rows]
        out.sort(key=lambda t: term_sort_key(t["term"]), reverse=True)
        return out

    def lookup_course(self, course_code: str, term: Optional[str] = None) -> List[Dict[str, Any]]:
        """按课程代码查课程（含 sections）。term=None → 全部学期，最新在前。"""
        key = self._split_code(course_code)
        if key is None:
            return []
        subject, number = key
        sql = "SELECT * FROM courses WHERE subject = ? AND course_number = ?"
        params: List[Any] = [subject, number]
        if term:
            sql += " AND term = ?"
            params.append(term)
        rows = self._conn.execute(sql, params).fetchall()
        courses = [self._course_dict(r) for r in rows]
        courses.sort(key=lambda c: term_sort_key(c["term"]), reverse=True)
        for course in courses:
            course["sections"] = self._sections_of(course["term"], course["course_id"])
        return courses

    def sections_for(self, course_code: str, term: Optional[str] = None) -> List[Dict[str, Any]]:
        """按课程代码查 sections（扁平列表）。term=None → 全部学期，最新在前。"""
        key = self._split_code(course_code)
        if key is None:
            return []
        subject, number = key
        sql = (
            "SELECT s.* FROM sections s "
            "JOIN courses c ON c.term = s.term AND c.course_id = s.course_id "
            "WHERE c.subject = ? AND c.course_number = ?"
        )
        params: List[Any] = [subject, number]
        if term:
            sql += " AND s.term = ?"
            params.append(term)
        rows = self._conn.execute(sql, params).fetchall()
        sections = [self._section_dict(r) for r in rows]
        sections.sort(key=lambda s: (term_sort_key(s["term"]), s.get("section_code") or ""))
        sections.sort(key=lambda s: term_sort_key(s["term"]), reverse=True)
        return sections

    def instructor_courses(
        self,
        instructor_substring: str,
        term: Optional[str] = None,
        course_code: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """按教授全名或姓氏（大小写不敏感、精确边界）查开课 section。

        返回 section 记录 + 课程信息（course_code / title / units），
        名额字段与 availability_timestamp 原样带出。
        """
        instructor_query = self._resolve_instructor_query(instructor_substring)
        if instructor_query is None:
            return []
        match_mode, expected_name = instructor_query
        course_key = self._split_code(course_code) if course_code else None
        if course_code and course_key is None:
            return []
        sql = (
            "SELECT s.*, c.subject AS subject, c.course_number AS course_number, "
            "c.title AS title, c.units AS units "
            "FROM sections s "
            "JOIN courses c ON c.term = s.term AND c.course_id = s.course_id "
            "WHERE 1=1"
        )
        params: List[Any] = []
        if term:
            sql += " AND s.term = ?"
            params.append(term)
        if course_key:
            sql += " AND c.subject = ? AND c.course_number = ?"
            params.extend(course_key)
        rows = self._conn.execute(sql, params).fetchall()
        hits = []
        for row in rows:
            d = self._section_dict(row)
            if not any(self._instructor_matches(match_mode, expected_name, name) for name in d["instructors"]):
                continue
            d["course_code"] = f"{d['subject']} {d['course_number']}"
            hits.append(d)
        hits.sort(key=lambda h: (h["subject"], h["course_number"], h.get("section_code") or ""))
        hits.sort(key=lambda h: term_sort_key(h["term"]), reverse=True)
        return hits

    def instructor_grade_history(
        self,
        instructor_substring: str,
        course_code: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """按教授名查 Grade Archive Records，可选限定目标 Course ID。"""
        instructor_query = self._resolve_instructor_query(instructor_substring)
        if instructor_query is None:
            return []
        match_mode, expected_name = instructor_query
        course_key = self._split_code(course_code) if course_code else None
        if course_code and course_key is None:
            return []

        sql = "SELECT * FROM grade_records WHERE 1=1"
        params: List[Any] = []
        if course_key:
            sql += " AND target_subject = ? AND target_course_number = ?"
            params.extend(course_key)
        records = [
            dict(row)
            for row in self._conn.execute(sql, params).fetchall()
            if self._instructor_matches(match_mode, expected_name, row["instructor"])
        ]
        records.sort(key=_grade_sort_key, reverse=True)
        return records

    def grade_history(self, course_code: str) -> List[Dict[str, Any]]:
        """成绩档案记录（教授 × 学期粒度），按 年份/季度 降序。

        注意 ADR-0014：绝不在此合成单一课程 GPA，逐条返回原始记录。
        """
        key = self._split_code(course_code)
        if key is None:
            return []
        subject, number = key
        rows = self._conn.execute(
            "SELECT * FROM grade_records WHERE target_subject = ? AND target_course_number = ?",
            (subject, number),
        ).fetchall()
        records = [dict(r) for r in rows]
        records.sort(key=_grade_sort_key, reverse=True)
        return records

    def search_courses(
        self,
        subject: Optional[str] = None,
        units: Optional[Union[int, float, str]] = None,
        term: Optional[str] = None,
        limit: int = 50,
    ) -> List[Dict[str, Any]]:
        """按条件筛课（不含 sections，保持结果紧凑），最新学期在前。"""
        sql = "SELECT * FROM courses WHERE 1=1"
        params: List[Any] = []
        if subject:
            sql += " AND subject = ?"
            params.append(subject.strip().upper())
        if term:
            sql += " AND term = ?"
            params.append(term)
        rows = self._conn.execute(sql, params).fetchall()
        courses = [self._course_dict(r) for r in rows]
        if units is not None:
            courses = [c for c in courses if _units_match(c.get("units"), units)]
        courses.sort(key=lambda c: (c["subject"], c["course_number"]))
        courses.sort(key=lambda c: term_sort_key(c["term"]), reverse=True)
        return courses[: max(int(limit), 0)]


def _units_match(units_field: Optional[str], wanted: Union[int, float, str]) -> bool:
    """units 字段是字符串（"4" / "2, 4" / "2 or 4 or 6" / "1–12"）。

    精确匹配枚举值；范围写法（"1–12"）不猜测展开，视为不匹配。
    """
    if not units_field:
        return False
    if isinstance(wanted, float) and wanted.is_integer():
        wanted = int(wanted)
    wanted_str = str(wanted).strip()
    tokens = [t.strip() for part in units_field.split(",") for t in part.split(" or ")]
    return wanted_str in tokens
