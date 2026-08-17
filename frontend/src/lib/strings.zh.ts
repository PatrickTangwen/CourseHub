/**
 * 中文 chrome 文案:demo-zh 构建经 vite 插件整体替换 strings.ts。
 * 导出形状必须与 strings.ts 完全一致(键齐全断言见 demo.test.tsx);
 * EXAMPLE_PROMPTS 与英文版逐字相同——问题文本必须匹配实录会话。
 * 全部文案遵守 CONTEXT.md 的 Avoid 词表(绝不出现"转人工")。
 */
export const STRINGS = {
  appName: "CourseHub",
  tagline: "UCSD 课程问答助手",
  composerPlaceholder: "询问 UCSD 课程…",
  send: "发送",
  welcomeTitle: "欢迎使用 CourseHub",
  welcomeSubtitle:
    "课程内容、先修要求、上课时间、名额、授课教授、历史成绩、修课规划,都可以问。",
  requestFailed: "请求失败,请重试。",
  newChat: "新对话",
  deleteChat: "删除对话",
  retry: "重试",
  toggleConversationList: "切换会话列表",
  themeSystem: "主题:跟随系统",
  themeLight: "主题:浅色",
  themeDark: "主题:深色",
  backendConnected: "后端已连接",
  backendDisconnected: "后端不可用",
  backendChecking: "正在检查后端…",
  /** 输入框内状态胶囊的短标签;完整语义留给 aria-label。 */
  healthOk: "已连接",
  healthDown: "离线",
  healthChecking: "检查中…",
  developerPanel: "开发者",
  referralTitle: "这需要通过官方渠道处理",
  referralIntro:
    "个案事务(选课 Hold、先修豁免、Petition、成绩争议、特殊支持)由 UCSD 官方渠道处理:",
} as const;

/** Advisor Referral 的官方渠道(指路,不是报错)。 */
export const REFERRAL_CHANNELS = [
  { name: "Virtual Advising Center (VAC)", url: "https://vac.ucsd.edu" },
  { name: "你所在院系的 Advisor", url: "https://blink.ucsd.edu/instructors/advising/" },
  { name: "WebReg 支持", url: "https://students.ucsd.edu/academics/enroll/" },
] as const;

/** 过程时间线 chrome 与动态模板。 */
export const PROCESS_STRINGS = {
  thinking: "思考",
  thinkingActive: "思考中…",
  recallingContext: "回忆对话上下文",
  understandingQuestion: "理解问题",
  routingToSpecialists: "分配专家",
  searchingCourseIndex: "查询课程索引",
  readingCourseMaterials: "阅读课程资料",
  process: "过程",
  agentLabels: {
    general: "通用 Agent",
    course: "课程 Agent",
    planning: "规划 Agent",
  },
  recentMessages: (count: number) => `${count} 条近期消息`,
  relatedMemories: (count: number) => `${count} 条相关记忆`,
  profileAvailability: (available: boolean) =>
    `画像${available ? "可用" : "不可用"}`,
  summaryAvailability: (available: boolean) =>
    `摘要${available ? "可用" : "不可用"}`,
  intentSignals: "意图信号",
  signalLabels: {
    llm: "LLM 分类器",
    embedding: "向量相似度",
    pattern: "关键词模式",
    refined_by_pattern: "模式修正",
  } as Record<string, string>,
  signalLead: "主导",
  signalNone: "无信号",
  signalRefined: "修正了判定",
  leadAgent: (agent: string) => `${agent}(主)`,
  supportingAgent: (agent: string) => `${agent}(辅)`,
  toolCount: (count: number) => ` ×${count}`,
  succeeded: (count: number) => (count === 1 ? "成功" : `${count} 个成功`),
  failed: (count: number) => `${count} 个失败`,
  toolCalls: (count: number) => `${count} 次工具调用`,
} as const;

/** 开发者面板 chrome 与状态消息。 */
export const DEV_STRINGS = {
  title: "CourseHub 开发者面板",
  backToChat: "返回聊天",
  refresh: "刷新",
  knowledgeBase: "知识库",
  stats: (chunks: number, documents: number, courseDocuments: number) =>
    `${chunks} 个分块 · ${documents} 篇文档 · ${courseDocuments} 篇课程文档`,
  statsUnavailable: "统计不可用。",
  documentTitle: "文档标题",
  documentContent: "文档内容",
  addDocument: "添加文档",
  addingDocument: "添加中…",
  uploadFile: "上传文件(.txt / .md / .json)",
  uploadingFile: "上传中…",
  importSucceeded: (chunks: number) => `已导入 ${chunks} 个文档分块。`,
  importFailed: "导入失败。",
  uploadSucceeded: (filename: string, chunks: number) =>
    `已上传 ${filename}(${chunks} 个分块)。`,
  uploadFailed: "上传失败。",
  monitor: "监控",
  monitorUnavailable: "监控不可用。",
  /** 告警默认折叠:持续超标的指标会一直活跃,摊开就是刷屏。 */
  activeAlerts: (count: number) => `${count} 条活跃告警`,
  alertRepeats: (count: number) => `×${count}`,
  agent: "Agent",
  runs: "运行次数",
  success: "成功率",
  averageMs: "平均耗时 ms",
  penalty: "降权",
  routingScore: "路由分",
  tool: "工具",
  calls: "调用次数",
  averageLatencyMs: "平均延迟 ms",
  circuit: "熔断",
  skills: "Skills",
  reloadSkills: "重载 Skills",
  reloadingSkills: "重载中…",
  skillsReloaded: "Skills 已重载。",
  skillsReloadFailed: "Skills 重载失败。",
  skillsUnavailable: "Skills 不可用。",
  keywords: (count: number) => `${count} 个关键词`,
  skillAgents: "适用 Agent",
  skillStatus: "状态",
  skillEnabled: "启用",
  skillDisabled: "停用",
  skillSource: "来源",
  skillTriggerKeywords: "触发关键词",
  skillRules: "规则",
  skillContentUnavailable: "规则内容不可用。",
} as const;

/** 空态示例问题:与英文版逐字相同(必须匹配实录会话的问题文本)。 */
export const EXAMPLE_PROMPTS = [
  { icon: "course", prompt: "What does CSE 100 cover?" },
  { icon: "professor", prompt: "Who teaches CSE 101 in FA26?" },
  { icon: "prereq", prompt: "CSE 100 有哪些先修要求?" },
  { icon: "planning", prompt: "帮我规划 CSE 100 和 CSE 110 的修课顺序" },
] as const;
