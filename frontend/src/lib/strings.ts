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
  streamEndedUnexpectedly: "The stream ended unexpectedly. Please try again.",
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

/** 空态示例问题:中英各半,点击即发送,顺带展示双语自适应能力。 */
export const EXAMPLE_PROMPTS = [
  "What does CSE 100 cover?",
  "Who teaches CSE 101 in FA26?",
  "CSE 100 有哪些先修要求?",
  "帮我规划 CSE 100 和 CSE 110 的修课顺序",
] as const;
