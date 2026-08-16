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
} as const;
