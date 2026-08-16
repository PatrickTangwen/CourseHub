"""course_lookup 结果进 prompt 前的压缩:只做结构级取舍,绝不按字符切。

半截 description 会被模型照抄成半句(线上曾把 CSE 100 的
"Uses C++ and STL." 输出成 "Uses…"),所以描述要么给全,要么整条省略。
"""
import sys
import types

import pytest

pytest.importorskip("fastapi")


@pytest.fixture()
def compact(monkeypatch):
    mem_stub = types.ModuleType("memory.conversation_memory")
    mem_stub.MsgRole = types.SimpleNamespace(USER=None, ASSISTANT=None)
    monkeypatch.setitem(sys.modules, "memory.conversation_memory", mem_stub)
    import api.main as main

    return main._compact_lookup_data


# CSE 100 的真实描述:374 字符,旧的 300 字符阈值正好切在 "Uses" 之后。
CSE100_DESC = (
    "High-performance data structures and supporting algorithms. Use and "
    "implementation of data structures like (un)balanced trees, graphs, priority "
    "queues, and hash tables. Also, memory management, pointers, recursion. "
    "Theoretical and practical performance analysis, both average case and "
    "amortized. Uses C++ and STL. Recommended preparation: background in C or "
    "C++ programming."
)


def test_focused_result_keeps_the_whole_description(compact):
    out = compact({"results": [{"course_code": "CSE 100", "description": CSE100_DESC}]})
    assert out["results"][0]["description"] == CSE100_DESC
    assert "…" not in out["results"][0]["description"]
    assert "description_omitted" not in out["results"][0]


def test_list_result_omits_description_and_says_where_to_look(compact):
    out = compact({
        "results": [
            {"course_code": f"CSE 1{i}", "description": CSE100_DESC} for i in range(5)
        ]
    })
    for item in out["results"]:
        assert "description" not in item
        assert "知识库检索结果" in item["description_omitted"]


def test_abnormally_long_description_is_dropped_not_sliced(compact):
    out = compact({"results": [{"course_code": "CSE 100", "description": "x" * 2500}]})
    item = out["results"][0]
    assert "description" not in item
    assert item["description_omitted"]


def test_structural_limits_still_apply(compact):
    out = compact({
        "results": [{"course_code": f"C{i}"} for i in range(20)],
    })
    assert len(out["results"]) == 12
    assert out["results_omitted"] == 8

    out = compact({"results": [{"sections": [{"id": i} for i in range(10)]}]})
    assert len(out["results"][0]["sections"]) == 8
    assert out["results"][0]["sections_omitted"] == 2
