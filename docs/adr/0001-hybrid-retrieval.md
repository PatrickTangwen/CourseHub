---
status: accepted
---

# Hybrid retrieval: semantic RAG plus a structured Course Index

CourseHub answers two different kinds of course questions: "what is this course about" (semantic) and "when does it meet / how many seats / what GPA did instructor X's offering get" (exact facts over 19,041 term-course records). Pure vector retrieval was rejected for the second kind — embedding search over near-duplicate per-term course documents cannot reliably return the right term's numbers, and a wrong-but-plausible seat count or GPA is worse than no answer. We therefore run both: a vector knowledge base holding one Knowledge Doc per unique course (content from the latest term offering it), and a SQLite Course Index built from the 15 published term snapshots, queried via a `course_lookup` tool registered in the existing MCP tool manager (inheriting its circuit breaker, cache, and monitoring). Entity hits (Course Code, Instructor) trigger the structured lookup alongside semantic search, and both results are merged into the generation context — the main pipeline's shape (retrieve → assemble context → generate) is unchanged.

## Considered options

- **Pure RAG over per-term documents (19,041 docs)**: rejected — top-K fills with 15 near-identical copies of the same course, and exact numbers still come out of generation rather than data.
- **Pure structured lookup, no vector KB**: rejected — cannot serve "find courses about machine learning"-style semantic queries, which are the assistant's core discovery use case.

## Consequences

- Exact numbers (seats, times, GPA records) must always be sourced from Course Index results, never generated; SKILL.md rules enforce this at the prompt layer.
- The Course Index is rebuilt by the offline preprocessing script whenever the published snapshots change; it is a derived artifact, never hand-edited.
