# TSS And WebReg Transition Link Archive

Date: 2026-07-18

Status: unified archive for links discussed while researching UCSD WebReg,
TSS, Schedule of Classes, seats freshness, and `coursetable-ucsd` data-source
boundaries.

## Bottom Line

The links below support a consistent direction:

- UCSD is moving student booking/enrollment and many legacy TritonLink/WebReg
  workflows into the Triton Student System (TSS).
- Summer 2026 still uses legacy WebReg and the legacy public Schedule of
  Classes.
- Fall 2026 booking is moving to TSS, TSS Booking, TEA, and TSS-era Schedule of
  Classes surfaces.
- None of the links observed so far provide a public real-time seats API or
  third-party developer contract.
- For `coursetable-ucsd`, seats should still be described as snapshot /
  `updated as of` data unless an official TSS/Booking integration path is
  obtained or a documented public endpoint is verified after launch.

## User-Provided Links

### TSS Application-Impact Google Doc

URL:
`https://docs.google.com/document/d/1fHj8FpxVfecCMlojX64OC6fLsoRJNTp4xzrLUsroZ_I/edit?tab=t.0`

Use in this archive:

- Tracks applications affected by TSS.
- Relevant observed rows included `Enrollment/Waitlists`, `Schedule of
Classes`, `Instructional Scheduling Assistant (ISA)`, and `WebReg`.
- Important for product planning, but not an API document.

Observed Coursetable implication:

- Confirms the high-level migration away from legacy WebReg/Schedule of Classes
  workflows.
- Does not confirm public real-time seats API availability.

### Blink TSS Training / Scheduling In ISA

URL:
`https://blink.ucsd.edu/instructors/resources/tss/index.html#scheduling-in-isa-training-resources`

Use in this archive:

- Faculty/staff training page for TSS.
- Explains TSS, Booking, ISA, TEA, and scheduling/booking training.
- Shows that Booking is the TSS term for class registration/enrollment.
- Shows a split between `Schedule of Classes (Summer 26)` on `act.ucsd.edu` and
  `Schedule of Classes (Fall 26)` on `tss.ucsd.edu`.

Observed Coursetable implication:

- Useful evidence that the schedule/enrollment surface is changing for Fall 2026.
- Not an API contract.

### TritonLink Student Tool Help

URL:
`https://students.ucsd.edu/my-tritonlink/tools/tool-help/index.html`

Use in this archive:

- Student-facing help hub.
- Says MyTritonLink is being retired and replaced with TSS.
- Separates Fall 2026 TSS booking resources from Summer 2026 WebReg/Schedule of
  Classes resources.

Observed Coursetable implication:

- Confirms the student-facing transition timeline.
- Useful for UI wording around Summer 2026 vs Fall 2026 behavior.

### UCSD Admin Records TSS Access Notice

URL:
`https://adminrecords.ucsd.edu/Notices/2026/2026-7-10-1.html`

Use in this archive:

- Official July 10, 2026 campus notice about TSS access.
- States faculty/staff access starts July 13, 2026.
- States main campus student access starts July 20, 2026.
- States Division of Extended Studies student access starts August 7, 2026.
- States TEA replaces EASy and becomes available July 20, 2026.
- States the first wave of students begins booking classes on July 22, 2026.
- Points authorized users to `http://sis.ucsd.edu`.

Observed Coursetable implication:

- Gives concrete dates for when post-launch TSS behavior should be re-checked.
- Still does not provide an API or endpoint contract.

### Reddit WebReg/TSS Transition Thread

URL:
`https://www.reddit.com/r/UCSD/comments/1sbiheg/webreg_will_be_replaced_by_third_party_solution/`

Use in this archive:

- Community/student experience signal.
- Claims WebReg will be replaced by a third-party solution and TritonGPT, and
  that Fall enrollment is pushed to July.
- Raises UX concerns about losing WebReg-style calendar planning, viewing only a
  small number of lecture/discussion options, extra booking clicks, full-class
  filtering, and lecture/discussion pairing.

Observed Coursetable implication:

- Useful product signal: students value fast calendar comparison and clear
  lecture/discussion exploration.
- Not authoritative for data-source or API decisions.
- CourseLeaf/WebReg replacement claims need official confirmation before being
  treated as fact.

## UCSD Official Links Checked Or Discussed

### Public Schedule Of Classes

URL:
`https://act.ucsd.edu/scheduleOfClasses/scheduleOfClassesStudent.htm`

Related result endpoint:
`https://act.ucsd.edu/scheduleOfClasses/scheduleOfClassesStudentResult.htm`

Related subject-list endpoint example:
`https://act.ucsd.edu/scheduleOfClasses/subject-list.json?selectedTerm=S126`

Use in this archive:

- Current public source used by the local snapshot pipeline.
- Exposes Schedule of Classes HTML with seats fields such as `Seats Available`
  and `Limit`.
- The page states the information is updated nightly.

Observed Coursetable implication:

- Good source for nightly or scheduled snapshots.
- Not a real-time enrollment source.

### Booking Your Classes / Enrolling In Classes

URL:
`https://students.ucsd.edu/academics/enroll/index.html`

Use in this archive:

- Student-facing booking/enrollment page.
- Says Summer Session 2026 continues with current systems.
- Says students will log into TSS to find available classes and book Fall 2026
  courses.

Observed Coursetable implication:

- Confirms term-specific transition: Summer 2026 legacy, Fall 2026 TSS.

### Student Tools

URL:
`https://students.ucsd.edu/my-tritonlink/tools/`

Use in this archive:

- Lists Summer 2026 classes/enrollment tools: WebReg, Schedule of Classes, EASy,
  Holds, Canvas.
- Lists Fall 2026 classes/booking tools: TSS, Schedule of Classes, TEA, Canvas.
- Describes Schedule of Classes as showing class times, sizes, available seats,
  prerequisites, and faculty listings.

Observed Coursetable implication:

- Useful for distinguishing legacy public Schedule of Classes from TSS-era
  Schedule of Classes.

### Schedule Of Classes Help

URL:
`https://students.ucsd.edu/my-tritonlink/tools/tool-help/schedule-of-classes.html`

Use in this archive:

- Student guide for using Schedule of Classes.
- Includes the TSS transition warning for Fall 2026.

Observed Coursetable implication:

- Confirms that older Schedule of Classes instructions are for current/legacy
  enrollment and may not apply Fall 2026 or later.

### WebReg Tutorial

URL:
`https://students.ucsd.edu/my-tritonlink/tools/tool-help/webreg-tutorial/index.html`

Use in this archive:

- Legacy WebReg tutorial.
- Includes warning that TSS will be used for Fall 2026 and beyond.

Observed Coursetable implication:

- WebReg-specific behavior should not be treated as the future booking model.

### TritonGPT Class Planner

URL:
`https://students.ucsd.edu/my-tritonlink/tools/tool-help/tgpt-planner.html`

Use in this archive:

- Student-facing TritonGPT planner help.
- Relevant because UCSD appears to be putting short-term class planning support
  outside TSS in TritonGPT.

Observed Coursetable implication:

- Confirms that planning and booking may be split across tools during the
  transition.

### Undergraduate Enrollment

URL:
`https://students.ucsd.edu/academics/enroll/undergraduate-enrollment/`

Use in this archive:

- Student-facing undergraduate enrollment page.
- Lists TSS as available for Fall 2026 course booking and keeps WebReg/Schedule
  of Classes tied to Summer 2026.

Observed Coursetable implication:

- Another term-boundary source for Summer 2026 vs Fall 2026.

### TSS Project / ESR Core SIS

URL:
`https://esr.ucsd.edu/projects/student/ecosystem/core-sis.html`

Use in this archive:

- Official ESR page for the Triton Student System.
- Mentions TSS launch preparation and integrated platforms such as CourseLeaf
  and TSS.

Observed Coursetable implication:

- Confirms CourseLeaf appears in UCSD's TSS ecosystem/integration context.
- Does not by itself prove CourseLeaf is the student-facing WebReg replacement.

### TSS Role Access KBA

URL:
`https://support.ucsd.edu/its?id=kb_article_view&sysparm_article=KB0036314`

Use in this archive:

- TSS role/access path discussed as the likely route for official non-public TSS
  access.

Observed Coursetable implication:

- If live seats become a requirement, official role/data-sharing access would
  likely matter more than scraping.

### UCSD Technology Resources

URL:
`https://blink.ucsd.edu/technology/help-desk/tech-resources/index.html`

Use in this archive:

- UCSD technology resources page listing campus tools such as enrollment,
  waitlists, Schedule of Classes, class lists, and related systems.

Observed Coursetable implication:

- Useful orientation page, not an API page.

## CourseLeaf / Third-Party Context Links

### CourseLeaf Main Site

URL:
`https://www.courseleaf.com/`

Use in this archive:

- Third-party academic operations platform referenced while checking Reddit's
  `third party solution` claim.

Observed Coursetable implication:

- Helps understand what CourseLeaf is generally.
- Does not prove UCSD student-facing booking is CourseLeaf.

### UCSD CourseLeaf Course Approval Form News

URL:
`https://esr.ucsd.edu/news/posts/sis-courseleaf-course-approvals-sep-25.html`

Use in this archive:

- UCSD ESR page about CourseLeaf course approval form.
- Discusses CourseLeaf phases and TSS relationship.

Observed Coursetable implication:

- Confirms CourseLeaf exists in UCSD's SIS modernization program.
- Does not establish it as the WebReg replacement.

### TSS Process Group 2 News

URL:
`https://esr.ucsd.edu/news/posts/sis-tss-process-group-2-feb-25.html`

Use in this archive:

- ESR news page saying the team was reviewing possible replacements for WebReg,
  including CourseLeaf and uAchieve.

Observed Coursetable implication:

- Supports that CourseLeaf was under consideration in the WebReg replacement
  conversation.
- It is not final proof of the replacement architecture.

## Current Product Guidance For Coursetable

- Use official UCSD sources for data-source facts.
- Treat Reddit as student sentiment and UX risk evidence only.
- Keep seat data wording honest: `snapshot`, `updated as of`, `not live`.
- Re-check `tss.ucsd.edu`, `sis.ucsd.edu`, and the Fall 2026 TSS Schedule of
  Classes after TSS student access and booking are live.
- Do not claim a public real-time seats API until an official documented API or
  stable observable public endpoint is verified.
- If the goal is to compete with or complement TSS during the transition,
  prioritize:
  - fast calendar comparison,
  - clear lecture/discussion pairing,
  - transparent seat freshness,
  - readable snapshot timestamps,
  - and graceful distinction between Summer 2026 legacy data and Fall 2026 TSS
    data.
