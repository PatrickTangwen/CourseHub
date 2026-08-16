"""CourseIndex：SQLite Course Index 的结构化查询（纯 stdlib）。

铁律（ADR-0001）：名额 / 时间 / GPA 等精确数字只来自这里的查询结果，
绝不靠生成。所有包含名额数字的 section 结果都带 availability_timestamp
与 term，供回答层标注快照时间戳。
"""
import json
import pathlib
import sqlite3
from typing import Any, Dict, List, Optional, Union

from coursedata.normalize import normalize_course_code, term_sort_key

PathLike = Union[str, pathlib.Path]

# 成绩档案年份是两位数（"16" → 2016）；<50 视为 2000 年代。
_YEAR_PIVOT = 50

# 成绩档案季度顺序（同 normalize._QUARTER_ORDER，含夏季小学期以防万一）
_QUARTER_ORDER = {"WI": 0, "SP": 1, "S1": 2, "S2": 3, "S3": 4, "FA": 5}


def _grade_sort_key(row: Dict[str, Any]):
    try:
        year = int(row.get("year") or -1)
    except (TypeError, ValueError):
        return (-1, -1)
    if 0 <= year < _YEAR_PIVOT:
        year += 2000
    elif year >= _YEAR_PIVOT:
        year += 1900
    return (year, _QUARTER_ORDER.get(row.get("quarter"), -1))


class CourseIndex:
    """打开 course_index.sqlite 的只读查询接口。所有方法返回普通 dict/list。"""

    def __init__(self, db_path: PathLike, check_same_thread: bool = True):
        self._conn = sqlite3.connect(str(db_path), check_same_thread=check_same_thread)
        self._conn.row_factory = sqlite3.Row

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

    def instructor_courses(self, instructor_substring: str, term: Optional[str] = None) -> List[Dict[str, Any]]:
        """按教授名（大小写不敏感子串）查开课 section。

        返回 section 记录 + 课程信息（course_code / title / units），
        名额字段与 availability_timestamp 原样带出。
        """
        needle = (instructor_substring or "").strip().lower()
        if not needle:
            return []
        sql = (
            "SELECT s.*, c.subject AS subject, c.course_number AS course_number, "
            "c.title AS title, c.units AS units "
            "FROM sections s "
            "JOIN courses c ON c.term = s.term AND c.course_id = s.course_id "
            "WHERE instr(lower(s.instructors_json), ?) > 0"
        )
        params: List[Any] = [needle]
        if term:
            sql += " AND s.term = ?"
            params.append(term)
        rows = self._conn.execute(sql, params).fetchall()
        hits = []
        for row in rows:
            d = self._section_dict(row)
            d["course_code"] = f"{d['subject']} {d['course_number']}"
            hits.append(d)
        hits.sort(key=lambda h: (h["subject"], h["course_number"], h.get("section_code") or ""))
        hits.sort(key=lambda h: term_sort_key(h["term"]), reverse=True)
        return hits

    def grade_history(self, course_code: str) -> List[Dict[str, Any]]:
        """成绩档案记录（教授 × 学期粒度），按 年份/季度 降序。

        注意 ADR-0014：绝不在此合成单一课程 GPA，逐条返回原始记录。
        """
        key = self._split_code(course_code)
        if key is None:
            return []
        subject, number = key
        rows = self._conn.execute(
            "SELECT * FROM grade_records WHERE subject = ? AND course_number = ?",
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
