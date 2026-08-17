# CourseHub Assistant

CourseHub is a multi-agent Q&A assistant that answers UCSD course questions (course facts and planning advice) from SunGrid catalog snapshots. It evolved from an earlier customer-service backend: the pipeline (intent fusion → agent routing → retrieval-augmented generation → memory) is unchanged; only the domain content is swapped.

## Language

### Agents

**General Agent**:
The first-line agent. Handles greetings, capability/meta questions, and clarification when intent is unclear.
_Avoid_: 通用客服, customer service agent

**Course Agent**:
The facts specialist. Answers course-fact questions (content, prerequisites, schedule, availability, instructors, grade history) grounded strictly in catalog data.
_Avoid_: technical agent, catalog agent, course_info agent

**Planning Agent**:
The advice specialist. Gives leaning-but-disclaimed course-planning suggestions (sequencing, workload, professor choice) grounded in catalog data.
_Avoid_: billing agent, advising agent (it is explicitly NOT official advising)

**Advisor Referral**:
The escalation outcome: directing the user to official channels (VAC, department advisors, WebReg support) for case-specific matters the assistant cannot resolve (enrollment holds, prereq waivers, petitions, grade disputes, accommodations). `escalated=true` means "referred to official channels".
_Avoid_: 转人工, human handoff, transfer to human agent

### Intents

**Intent Group**:
One of `facts` / `planning` / `general` / `escalation` / `other`. Drives agent routing: facts → Course Agent, planning → Planning Agent, general/other → General Agent, escalation → Advisor Referral.

**Facts Intents** (group `facts`):
`course_overview` (what a course covers, units), `prerequisites` (prereq/restriction text), `schedule` (meeting days/times/rooms), `availability` (seats/waitlist), `instructor_lookup` (who teaches), `grades_history` (GPA/grade distributions), `course_search` (find courses by criteria).

**Planning Intents** (group `planning`):
`plan_sequence` (what order to take courses), `workload_advice` (course-combination load assessment), `professor_choice` (which section/instructor to pick).

**General Intents** (group `general`):
`greeting`, `meta_info` (data source, freshness, capability boundaries).

**Escalation Intent** (group `escalation`):
`advisor_referral` — see Advisor Referral above.

### Entities

**Course Code**:
Normalized subject + number, e.g. "CSE 100" (from "cse100", "CSE-100"). Matches SunGrid's Course ID vocabulary.

**Term Code**:
SunGrid term code (FA26, WI25, SP25, S126, …). Natural-language mentions ("Fall 2026", "2026 秋") normalize to a Term Code; relative mentions ("下学期") default to the Active Planning Term.

**Subject**:
A UCSD subject code (CSE, MATH, AAS, …) from the catalog's configured-subject vocabulary.

**Instructor**:
An instructor name string as it appears in catalog data. Not a first-class entity upstream (no instructor ID); matching is by name dictionary.

**Units**:
Course credit units as recorded in the catalog.

### Knowledge & answers

**Knowledge Doc**:
A text document rendered from catalog data for semantic retrieval (the RAG side of retrieval). One per unique course (subject + number), content drawn from the most recent term offering it, listing all terms offered.

**Course Index**:
The structured, queryable index built from the 15 published term snapshots, used for exact-fact lookups.

**Course Lookup**:
The structured query capability over the Course Index (schedule, seats, grade records, offerings by term). Complements semantic retrieval; exact numbers come from here, never from generation.
_Avoid_: database search, knowledge search (that is the semantic side)

**Answer-Safety Constraint**:
A rule inherited from SunGrid that binds reply wording: availability numbers always carry the snapshot timestamp and are never presented as live; no single course-level GPA summary — grade history is reported per instructor × term (SunGrid ADR-0014); missing catalog descriptions are stated as missing, never invented; data gaps are acknowledged, not escalated.

**Planning Disclaimer**:
The standing notice on every Planning Agent recommendation: unofficial, not academic advising; consult an advisor for decisions.
