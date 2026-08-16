# Use Verification Codes For First Real Email Login

Status: accepted. Narrows ADR 0007 for the first hosted email-login rollout.

The first real UCSD email login rollout should use a 6-digit verification code
rather than a magic link. The existing App Backend already models verification
codes, so staging can test deliverability, hosted HTTPS cookies, Redis session
restore, and App DB ownership with the smallest change from the validated local
flow.

**Considered Options**

- Use a magic link for the first hosted rollout. Rejected for now because it
  adds callback URL handling, link signing, cross-device browser behavior,
  expired-link states, and email-client link-prefetch concerns before the basic
  hosted auth path is proven.
- Keep the development-only `devCode` seam. Rejected for hosted staging because
  it does not test real mailbox delivery or user-facing code-entry behavior.

**Consequences**

- The staging email provider integration sends a short-lived 6-digit code.
- The login UI remains a two-step email/code flow for the first hosted rollout.
- Magic links remain a future option after real-email staging proves the App
  Backend path.
