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
