import core.intent_recognizer as intent_module
from core.intent_recognizer import IntentRecognizer


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
