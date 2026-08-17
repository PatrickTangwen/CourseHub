from core.skill_loader import SkillManager


def test_skill_summary_only_includes_content_when_requested(tmp_path):
    skill_dir = tmp_path / "course_facts"
    skill_dir.mkdir()
    (skill_dir / "SKILL.md").write_text(
        """---
name: Course facts
description: Answer safety rules
keywords: prerequisite,gpa
agents: course
enabled: true
---

# Course facts

Always ground exact numbers in structured data.
""",
        encoding="utf-8",
    )
    manager = SkillManager(str(tmp_path))
    manager.load()

    summary = manager.summary()
    assert "content" not in summary["skills"][0]

    detailed = manager.summary(include_content=True)
    assert detailed["skills"][0]["content"] == (
        "Always ground exact numbers in structured data."
    )
