import asyncio
from types import SimpleNamespace

from core.intent_recognizer import IntentCategory, UrgencyLevel
from evaluation.evaluator import EndToEndEvaluator, QualityScores, check_dialog_constraints


def test_availability_constraint_requires_timestamp_and_non_live_disclaimer():
    failures = check_dialog_constraints(
        ["availability_snapshot"],
        response="FA26 的 CSE 100 还剩 0 个座位。",
        intent="availability",
        agent_type="course",
        escalated=False,
        entities={"course_code": ["CSE 100"], "term": ["FA26"]},
    )

    assert failures == [
        "availability_snapshot: missing snapshot timestamp",
        "availability_snapshot: missing non-live disclaimer",
    ]
    assert check_dialog_constraints(
        ["availability_snapshot"],
        response="快照时间 2026-08-12T16:39:36Z；剩余 0 个座位，非实时，请以 WebReg 为准。",
        intent="availability",
        agent_type="course",
        escalated=False,
        entities={"course_code": ["CSE 100"], "term": ["FA26"]},
    ) == []


def test_course_context_constraint_requires_carried_course_entity():
    failures = check_dialog_constraints(
        ["course_context"],
        response="CSE 100 的先修要求如下。",
        intent="prerequisites",
        agent_type="course",
        escalated=False,
        entities={"course_code": [], "term": []},
    )

    assert failures == ["course_context: missing CSE 100 entity"]
    assert check_dialog_constraints(
        ["course_context"],
        response="CSE 100 的先修要求如下。",
        intent="prerequisites",
        agent_type="course",
        escalated=False,
        entities={"course_code": ["CSE 100"], "term": []},
    ) == []


def test_grade_constraint_rejects_a_single_synthesized_course_gpa():
    failures = check_dialog_constraints(
        ["grade_history"],
        response="CSE 100 的平均 GPA 是 3.42。",
        intent="grades_history",
        agent_type="course",
        escalated=False,
        entities={"course_code": ["CSE 100"], "term": []},
    )

    assert failures == [
        "grade_history: missing refusal to synthesize course GPA",
        "grade_history: missing instructor-by-term evidence",
    ]
    assert check_dialog_constraints(
        ["grade_history"],
        response="我不会合成单一课程 GPA。WI26 · Sahoo, Debashis · GPA 3.346。",
        intent="grades_history",
        agent_type="course",
        escalated=False,
        entities={"course_code": ["CSE 100"], "term": []},
    ) == []


def test_planning_constraint_requires_planning_agent_and_disclaimer():
    failures = check_dialog_constraints(
        ["planning_disclaimer"],
        response="建议先修 CSE 100。",
        intent="plan_sequence",
        agent_type="course",
        escalated=False,
        entities={"course_code": ["CSE 100"], "term": []},
    )

    assert failures == [
        "planning_disclaimer: expected planning agent",
        "planning_disclaimer: missing disclaimer",
    ]
    assert check_dialog_constraints(
        ["planning_disclaimer"],
        response="建议先修 CSE 100。\n本建议为非官方参考，选课决策请咨询学校学业顾问。",
        intent="plan_sequence",
        agent_type="planning",
        escalated=False,
        entities={"course_code": ["CSE 100"], "term": []},
    ) == []


def test_referral_constraint_requires_flag_marker_and_official_channel():
    failures = check_dialog_constraints(
        ["advisor_referral"],
        response="这个问题我无法处理。",
        intent="advisor_referral",
        agent_type="general",
        escalated=False,
        entities={"course_code": [], "term": []},
    )

    assert failures == [
        "advisor_referral: escalated flag is false",
        "advisor_referral: missing referral marker",
        "advisor_referral: missing official channel",
    ]
    assert check_dialog_constraints(
        ["advisor_referral"],
        response="请联系 Virtual Advising Center 或院系 advisor。\n[转介]",
        intent="advisor_referral",
        agent_type="general",
        escalated=True,
        entities={"course_code": [], "term": []},
    ) == []


def test_expected_route_is_a_hard_constraint():
    failures = check_dialog_constraints(
        [],
        response="课程信息如下。",
        intent="other",
        agent_type="general",
        escalated=False,
        entities={"course_code": ["CSE 100"], "term": []},
        expected_intent="course_overview",
        expected_agent_type="course",
    )

    assert failures == [
        "route: expected intent course_overview, got other",
        "route: expected agent course, got general",
    ]


def test_public_evaluator_run_fails_a_high_scoring_response_that_breaks_constraints():
    class Recognizer:
        async def recognize(self, message, history=None):
            return SimpleNamespace(
                intent=IntentCategory.AVAILABILITY,
                intent_group="facts",
                urgency=UrgencyLevel.LOW,
                confidence=1.0,
                entities={"course_code": ["CSE 100"], "term": ["FA26"]},
            )

    class Orchestrator:
        async def run(self, request):
            return SimpleNamespace(
                response="FA26 CSE 100 has 0 seats.",
                intent=IntentCategory.AVAILABILITY,
                agent_type=SimpleNamespace(value="course"),
                escalated=False,
            )

    class PerfectJudge:
        async def judge(self, question, response, context=None):
            return QualityScores(1.0, 1.0, 1.0, 1.0)

    recognizer = Recognizer()
    evaluator = EndToEndEvaluator(
        orchestrator=Orchestrator(),
        recognizer=recognizer,
        api_key="test-key",
        base_url="https://example.invalid",
    )
    evaluator._judge = PerfectJudge()

    report = asyncio.run(evaluator.run(dialog_cases=[{
        "question": "Is there space left in CSE 100?",
        "constraints": ["availability_snapshot"],
        "expected_intent": "availability",
        "expected_agent_type": "course",
    }]))

    assert report.pass_rate == 0.0
    assert report.results[0].passed is False
    assert report.results[0].metadata["constraint_failures"] == [
        "availability_snapshot: missing snapshot timestamp",
        "availability_snapshot: missing non-live disclaimer",
    ]
