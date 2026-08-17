import asyncio

import core.intent_recognizer as intent_module
from core.intent_recognizer import IntentCategory, IntentRecognizer


def _recognizer() -> IntentRecognizer:
    return IntentRecognizer(api_key="test-key", base_url="https://example.invalid")


def test_entity_context_resolves_course_pronouns_from_recent_user_turns():
    recognizer = _recognizer()
    history = [
        {"role": "user", "content": "我想了解 CSE 100"},
        {"role": "assistant", "content": "你想了解课程的哪一方面？"},
    ]

    prerequisite_entities = recognizer.extract_entities("它的先修是什么？", history=history)
    instructor_entities = recognizer.extract_entities("FA26 谁教这门课？", history=history)

    assert prerequisite_entities["course_code"] == ["CSE 100"]
    assert prerequisite_entities["subject"] == ["CSE"]
    assert instructor_entities["course_code"] == ["CSE 100"]
    assert instructor_entities["term"] == ["FA26"]


def test_two_letter_instructor_surname_requires_instructor_context(monkeypatch):
    recognizer = IntentRecognizer(api_key="test-key", base_url="https://example.invalid")
    monkeypatch.setattr(intent_module, "_dictionaries_loaded", True)
    monkeypatch.setattr(intent_module, "_INSTRUCTOR_LASTNAMES", {"li": "Li"})

    assert recognizer.extract_entities("Is Professor Li teaching CSE 100?")["instructor"] == ["Li"]
    assert recognizer.extract_entities("Li is a two-letter token")["instructor"] == []


def test_intent_cache_key_covers_all_history_used_for_entity_inheritance(monkeypatch):
    recognizer = IntentRecognizer(api_key="test-key", base_url="https://example.invalid")
    recognizer._embedding_enabled = False

    async def fake_llm(message, history):
        return {"intent": IntentCategory.PREREQUISITES, "confidence": 1.0, "reasoning": "test"}

    monkeypatch.setattr(recognizer, "_llm_recognize", fake_llm)
    shared_tail = [
        {"role": "assistant", "content": "好的。"},
        {"role": "user", "content": "谢谢"},
        {"role": "assistant", "content": "不客气。"},
    ]
    cse_history = [{"role": "user", "content": "我想了解 CSE 100"}, *shared_tail]
    math_history = [{"role": "user", "content": "我想了解 MATH 20C"}, *shared_tail]

    cse = asyncio.run(recognizer.recognize("它的先修是什么？", history=cse_history))
    math = asyncio.run(recognizer.recognize("它的先修是什么？", history=math_history))

    assert cse.entities["course_code"] == ["CSE 100"]
    assert math.entities["course_code"] == ["MATH 20C"]
    assert recognizer.cache_hits == 0
