/**
 * Centralized UI chrome copy (English-only per spec §1).
 * Keeping every user-visible string here keeps future i18n a mechanical change.
 */
export const STRINGS = {
  appName: "CourseHub",
  tagline: "UCSD course Q&A assistant",
  composerPlaceholder: "Ask about UCSD courses…",
  send: "Send",
  welcomeTitle: "Welcome to CourseHub",
  welcomeSubtitle:
    "Ask about courses, prerequisites, schedules, seats, professors, grade history, or planning advice.",
  requestFailed: "The request failed. Please try again.",
  newChat: "New chat",
  deleteChat: "Delete chat",
  retry: "Retry",
  toggleConversationList: "Toggle conversation list",
  themeSystem: "Theme: system",
  themeLight: "Theme: light",
  themeDark: "Theme: dark",
  backendConnected: "Backend connected",
  backendDisconnected: "Backend unreachable",
  backendChecking: "Checking backend…",
  /** 输入框内状态胶囊的短标签;完整语义留给 aria-label。 */
  healthOk: "Connected",
  healthDown: "Offline",
  healthChecking: "Checking…",
  developerPanel: "Developer",
  referralTitle: "This needs an official channel",
  referralIntro:
    "Case-specific matters (holds, waivers, petitions, disputes, accommodations) are handled by UCSD's official channels:",
} as const;

/** Advisor Referral 的官方渠道(指路,不是报错;绝不使用"转人工"表述)。 */
export const REFERRAL_CHANNELS = [
  { name: "Virtual Advising Center (VAC)", url: "https://vac.ucsd.edu" },
  { name: "Your department's advisors", url: "https://blink.ucsd.edu/instructors/advising/" },
  { name: "WebReg support", url: "https://students.ucsd.edu/academics/enroll/" },
] as const;

/** 过程时间线 chrome 与动态模板的单一事实来源。 */
export const PROCESS_STRINGS = {
  thinking: "Thinking",
  thinkingActive: "Thinking…",
  recallingContext: "Recalling conversation context",
  understandingQuestion: "Understanding the question",
  routingToSpecialists: "Routing to specialists",
  searchingCourseIndex: "Searching the course index",
  readingCourseMaterials: "Reading course materials",
  process: "Process",
  agentLabels: {
    general: "General Agent",
    course: "Course Agent",
    planning: "Planning Agent",
  },
  recentMessages: (count: number) => `${count} recent`,
  relatedMemories: (count: number) => `${count} related`,
  profileAvailability: (available: boolean) =>
    `profile ${available ? "available" : "unavailable"}`,
  summaryAvailability: (available: boolean) =>
    `summary ${available ? "available" : "unavailable"}`,
  /**
   * 三路意图信号:裸 key + 裸分数读不出信息量,尤其 0.00 会被读成
   * "向量检索没匹配上",而它常常只是这一路没参与。改用人话标签 +
   * "no signal" + 主导路标记。
   */
  intentSignals: "Intent signals",
  signalLabels: {
    llm: "LLM classifier",
    embedding: "Embedding similarity",
    pattern: "Keyword patterns",
    refined_by_pattern: "Pattern refinement",
  } as Record<string, string>,
  signalLead: "lead",
  signalNone: "no signal",
  signalRefined: "refined the vote",
  leadAgent: (agent: string) => `${agent} (lead)`,
  supportingAgent: (agent: string) => `${agent} (support)`,
  toolCount: (count: number) => ` ×${count}`,
  duration: (milliseconds: number) => `${Math.round(milliseconds)}ms`,
  succeeded: (count: number) => (count === 1 ? "succeeded" : `${count} succeeded`),
  failed: (count: number) => `${count} failed`,
  toolCalls: (count: number) => `${count} tool call${count === 1 ? "" : "s"}`,
  seconds: (milliseconds: number) => `${(milliseconds / 1000).toFixed(1)}s`,
} as const;

/** 隐藏开发者面板 chrome 与状态消息的单一事实来源。 */
export const DEV_STRINGS = {
  title: "CourseHub Developer Panel",
  backToChat: "Back to chat",
  refresh: "Refresh",
  knowledgeBase: "Knowledge base",
  stats: (chunks: number, documents: number, courseDocuments: number) =>
    `${chunks} chunks · ${documents} documents · ${courseDocuments} course documents`,
  statsUnavailable: "Stats unavailable.",
  documentTitle: "Document title",
  documentContent: "Document content",
  addDocument: "Add document",
  addingDocument: "Adding…",
  uploadFile: "Upload file (.txt / .md / .json)",
  uploadingFile: "Uploading…",
  importSucceeded: (chunks: number) =>
    `Imported ${chunks} document chunk${chunks === 1 ? "" : "s"}.`,
  importFailed: "Import failed.",
  uploadSucceeded: (filename: string, chunks: number) =>
    `Uploaded ${filename} (${chunks} chunk${chunks === 1 ? "" : "s"}).`,
  uploadFailed: "Upload failed.",
  monitor: "Monitor",
  monitorUnavailable: "Monitor unavailable.",
  agent: "Agent",
  runs: "Runs",
  success: "Success",
  averageMs: "Avg ms",
  penalty: "Penalty",
  routingScore: "Routing score",
  tool: "Tool",
  calls: "Calls",
  averageLatencyMs: "Avg latency ms",
  circuit: "Circuit",
  skills: "Skills",
  reloadSkills: "Reload skills",
  reloadingSkills: "Reloading…",
  skillsReloaded: "Skills reloaded.",
  skillsReloadFailed: "Skills reload failed.",
  skillsUnavailable: "Skills unavailable.",
  keywords: (count: number) => `${count} keyword${count === 1 ? "" : "s"}`,
} as const;

/** 空态示例问题:中英各半,点击即发送,顺带展示双语自适应能力。icon 只是视觉分类。 */
export const EXAMPLE_PROMPTS = [
  { icon: "course", prompt: "What does CSE 100 cover?" },
  { icon: "professor", prompt: "Who teaches CSE 101 in FA26?" },
  { icon: "prereq", prompt: "CSE 100 有哪些先修要求?" },
  { icon: "planning", prompt: "帮我规划 CSE 100 和 CSE 110 的修课顺序" },
] as const;
