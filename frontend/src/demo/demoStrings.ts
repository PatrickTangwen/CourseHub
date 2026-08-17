/**
 * Demo Mode 专属文案(与生产 chrome 的 strings.ts 分离,不进正常构建)。
 * 全部文案遵守 CONTEXT.md 的 Avoid 词表。
 */

/** 建议问题渲染为 markdown 链接,demo 壳的委托点击监听按此前缀接管。 */
export const ASK_PREFIX = "#ask=";

export const askHref = (question: string) =>
  `${ASK_PREFIX}${encodeURIComponent(question)}`;

const questionList = (questions: string[]) =>
  questions.map((q) => `- [${q}](${askHref(q)})`).join("\n");

/**
 * 仅 Demo:面板实录快照的英文标注(skills 名称/描述、告警文案)。
 * 规则正文保持实录原文;键是实录里的原始中文,重录后未覆盖的条目按原文显示。
 */
export const SKILL_LABELS_EN: Record<string, { name: string; description: string }> = {
  课程事实规范: {
    name: "Course Facts Rules",
    description:
      "Answer rules for the CourseHub Course Agent's objective course information, including five answer-safety constraints",
  },
  规划建议规范: {
    name: "Planning Advice Rules",
    description:
      "Rules for the CourseHub Planning Agent's course-planning suggestions, including the disclaimer and evidence-citation requirements",
  },
  接待分流规范: {
    name: "Reception & Routing Rules",
    description:
      "Rules for the CourseHub General Agent's bilingual reception, clarification, capability-boundary and meta-info answers",
  },
};

export const ALERT_MESSAGES_EN: Record<string, string> = {
  "course_0 的 agent_avg_ms = 13548.600，阈值 3000":
    "course_0 agent_avg_ms = 13548.600, threshold 3000",
};

/** 诚实横幅:应用壳外的一条细横幅,说明本页为实录回放。 */
export const DEMO_BANNER = {
  text: "Scripted demo — responses replay sessions pre-recorded from a real local deployment · 本页回放实录会话",
  linkLabel: "GitHub",
  repoUrl: "https://github.com/PatrickTangwen/CourseHub",
  dismiss: "Dismiss demo banner",
} as const;

/** Demo Notice:对脚本库外的自由输入的固定说明,按输入语言单语回复。 */
export const DEMO_NOTICE = {
  en: (questions: string[]) =>
    "**This is a scripted demo.** Answers here replay sessions pre-recorded " +
    "from a real local CourseHub deployment, so free-form questions are not " +
    "answered live. Try one of the recorded questions:\n\n" +
    questionList(questions),
  // 注意:闭合 ** 紧邻全角句号会破坏 CommonMark 的右侧翼判定,句号须在加粗之外。
  zh: (questions: string[]) =>
    "**这是一个脚本化演示页**。这里的回答回放实录自真实本地部署的会话," +
    "自由提问不会得到实时回答。试试下面这些已实录的问题:\n\n" +
    questionList(questions),
} as const;
