import asyncio

from agents.agent_orchestrator import (
    AgentOrchestrator,
    AgentType,
    Request,
    RoutingDecision,
)
from core.intent_recognizer import IntentCategory, UrgencyLevel


def test_low_confidence_english_request_gets_english_clarification():
    orchestrator = AgentOrchestrator(
        api_key="test-key",
        base_url="https://example.invalid",
    )
    request = Request(
        message="Could you help me figure this out?",
        user_id="user",
        conv_id="conversation",
        intent=IntentCategory.OTHER,
        intent_group="other",
        urgency=UrgencyLevel.LOW,
        intent_confidence=0.1,
    )

    result = asyncio.run(orchestrator.run(request))

    assert "Could you clarify" in result.response
    assert "课程内容" not in result.response
    assert result.agent_type.value == "general"


def test_clarification_reuses_the_supplied_routing_decision():
    orchestrator = AgentOrchestrator(
        api_key="test-key",
        base_url="https://example.invalid",
    )
    request = Request(
        message="Could you help me figure this out?",
        user_id="user",
        conv_id="conversation",
        intent=IntentCategory.OTHER,
        intent_group="other",
        urgency=UrgencyLevel.LOW,
        intent_confidence=0.1,
    )
    decision = RoutingDecision(
        primary_agent=AgentType.GENERAL,
        reason="single routing decision",
        confidence=0.42,
    )

    result = asyncio.run(orchestrator.run(request, decision=decision))

    assert result.routing_reason == decision.reason
    assert result.routing_confidence == decision.confidence


def _orchestrator_replying(reply):
    """构造一个 GeneralAgent 固定返回 reply 的编排器，用于转介标记相关测试。"""
    orchestrator = AgentOrchestrator(
        api_key="test-key",
        base_url="https://example.invalid",
    )

    async def fake_llm(req):
        return reply

    orchestrator._pool[AgentType.GENERAL][0]._call_llm = fake_llm
    return orchestrator


def _general_request(message, intent=IntentCategory.GENERAL):
    return Request(
        message=message,
        user_id="user",
        conv_id="conversation",
        intent=intent,
        intent_group="general",
        urgency=UrgencyLevel.LOW,
        intent_confidence=0.95,
    )


def test_english_referral_marker_escalates_and_is_stripped_from_response():
    orchestrator = _orchestrator_replying(
        "Enrollment holds must be resolved through official channels. "
        "Please contact the Virtual Advising Center.\n\n[Referral]"
    )
    request = _general_request(
        "I have an enrollment hold on my account - can you remove it?"
    )

    result = asyncio.run(orchestrator.run(request))

    assert result.escalated is True
    assert "[referral]" not in result.response.lower()
    assert "[转介]" not in result.response
    assert result.response.endswith("Please contact the Virtual Advising Center.")


def test_chinese_referral_marker_escalates_and_is_stripped_from_response():
    orchestrator = _orchestrator_replying(
        "这类事务需要通过官方渠道处理，请联系 Virtual Advising Center。\n\n[转介]"
    )
    request = _general_request("我的账户上有 enrollment hold，你能帮我解除吗？")

    result = asyncio.run(orchestrator.run(request))

    assert result.escalated is True
    assert "[转介]" not in result.response
    assert result.response.endswith("请联系 Virtual Advising Center。")


def test_response_without_marker_is_returned_verbatim_and_not_escalated():
    content = "CourseHub 可以回答课程内容、先修、名额与成绩历史等问题。\n\n欢迎提问！"
    orchestrator = _orchestrator_replying(content)
    request = _general_request("你好，你能做什么？", intent=IntentCategory.GREETING)

    result = asyncio.run(orchestrator.run(request))

    assert result.escalated is False
    assert result.response == content


def test_advisor_referral_uses_a_real_agent_and_marks_escalation():
    orchestrator = AgentOrchestrator(
        api_key="test-key",
        base_url="https://example.invalid",
    )
    request = Request(
        message="How do I get a prerequisite waiver?",
        user_id="user",
        conv_id="conversation",
        intent=IntentCategory.ADVISOR_REFERRAL,
        intent_group="escalation",
        urgency=UrgencyLevel.HIGH,
        intent_confidence=0.95,
    )

    result = asyncio.run(orchestrator.run(request))

    assert result.escalated is True
    assert result.primary_agent.value == "general"
    assert result.agent_type.value == "general"
