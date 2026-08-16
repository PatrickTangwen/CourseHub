import pathlib

import pytest

from coursedata.build import build_index
from mcp.course_lookup import plan_course_lookup_calls, register_course_lookup


FIXTURES = pathlib.Path(__file__).parent / "fixtures"


class RecordingToolManager:
    def __init__(self):
        self.tool = None

    def register(self, tool):
        self.tool = tool


@pytest.fixture()
def course_lookup(tmp_path):
    db_path = tmp_path / "course_index.sqlite"
    build_index([FIXTURES / "FA26-mini.json", FIXTURES / "S326-mini.json"], db_path)
    manager = RecordingToolManager()
    register_course_lookup(manager, db_path)
    assert manager.tool is not None
    return manager.tool.handler


def test_instructor_actions_support_evidence_for_professor_comparison(course_lookup):
    sections = course_lookup({
        "action": "instructor",
        "instructor": "Cao",
        "course_code": "CSE 100",
        "term": "FA26",
    })
    grades = course_lookup({
        "action": "instructor_grades",
        "instructor": "Sahoo",
        "course_code": "CSE 100",
    })

    assert sections["count"] == 1
    assert sections["results"][0]["course_code"] == "CSE 100"
    assert grades["count"] > 0
    assert all(row["target_course_number"] == "100" for row in grades["results"])


def test_professor_comparison_plan_queries_both_instructors_and_their_grades():
    calls, term_defaulted = plan_course_lookup_calls(
        "professor_choice",
        {
            "course_code": ["CSE 100"],
            "term": ["FA26"],
            "subject": ["CSE"],
            "instructor": ["Kane", "Sahoo"],
            "units": [],
        },
    )

    evidence_calls = {
        (call["action"], call.get("instructor"), call.get("course_code"))
        for call in calls
        if call["action"].startswith("instructor")
    }
    assert term_defaulted is False
    assert evidence_calls == {
        ("instructor", "Kane", "CSE 100"),
        ("instructor_grades", "Kane", "CSE 100"),
        ("instructor", "Sahoo", "CSE 100"),
        ("instructor_grades", "Sahoo", "CSE 100"),
    }
