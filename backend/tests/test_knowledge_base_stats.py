import json
import sys
import types

sys.modules.setdefault("chromadb", types.SimpleNamespace())
from mcp.knowledge_base import KnowledgeBase


class FakeCollection:
    def __init__(self):
        self.records = {}
        self.get_calls = []

    def count(self):
        return len(self.records)

    def upsert(self, *, ids, documents, metadatas):
        for item_id, document, metadata in zip(ids, documents, metadatas):
            self.records[item_id] = {"document": document, "metadata": metadata}

    def get(self, *, include=None, limit=None, where=None):
        self.get_calls.append({"include": include, "limit": limit, "where": where})
        items = list(self.records.items())
        if where is not None:
            key, value = next(iter(where.items()))
            items = [
                (item_id, item)
                for item_id, item in items
                if item["metadata"].get(key) == value
            ]
        if limit is not None:
            items = items[:limit]
        return {
            "ids": [item_id for item_id, _ in items],
            "metadatas": [item["metadata"] for _, item in items],
        }

    def delete(self, *, ids=None, where=None):
        if ids is not None:
            for item_id in ids:
                self.records.pop(item_id, None)
            return
        if where is not None:
            key, value = next(iter(where.items()))
            for item_id in list(self.records):
                if self.records[item_id]["metadata"].get(key) == value:
                    del self.records[item_id]


def test_course_docs_are_idempotent_and_stats_count_documents(tmp_path):
    kb = KnowledgeBase.__new__(KnowledgeBase)
    kb._collection = FakeCollection()
    docs_path = tmp_path / "knowledge_docs.json"
    docs_path.write_text(json.dumps([
        {
            "title": "CSE 100: Advanced Data Structures",
            "content": "CSE 100 course facts",
            "metadata": {"subject": "CSE", "course_number": "100"},
        },
        {
            "title": "MATH 20C: Calculus",
            "content": "MATH 20C course facts",
            "metadata": {"subject": "MATH", "course_number": "20C"},
        },
    ]), encoding="utf-8")

    assert kb.ensure_course_documents(docs_path) == 2
    assert kb.ensure_course_documents(docs_path) == 0
    kb.add_documents([{"title": "CourseHub capabilities", "content": "Meta facts"}], dataset="coursehub_meta")

    assert kb.stats() == {
        "total_chunks": 3,
        "total_documents": 3,
        "course_documents": 2,
    }


def test_course_document_readiness_uses_a_bounded_query(tmp_path):
    kb = KnowledgeBase.__new__(KnowledgeBase)
    kb._collection = FakeCollection()
    docs_path = tmp_path / "knowledge_docs.json"
    docs_path.write_text(json.dumps([{
        "title": "CSE 100: Advanced Data Structures",
        "content": "CSE 100 course facts",
        "metadata": {"subject": "CSE", "course_number": "100"},
    }]), encoding="utf-8")

    assert kb.has_course_documents() is False
    kb.ensure_course_documents(docs_path)
    assert kb.has_course_documents() is True
    assert kb._collection.get_calls[-1] == {
        "include": [],
        "limit": 1,
        "where": {"dataset": "coursehub_catalog"},
    }
