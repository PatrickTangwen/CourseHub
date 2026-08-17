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
