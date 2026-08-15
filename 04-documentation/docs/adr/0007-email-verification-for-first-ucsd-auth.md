# Email Verification For First UCSD Auth

Beta-1 Auth Foundation should start with email verification code or magic-link login for `@ucsd.edu` addresses, rather than Google OAuth. This makes UCSD User Identity depend on a verified UCSD email address while avoiding early Google OAuth consent, hosted-domain, and Calendar-scope coupling; Google OAuth can be added later when Google Calendar direct export is designed.

The first auth policy should reject non-`@ucsd.edu` email addresses instead of creating limited accounts. Anonymous catalog and Anonymous Worksheet use remain available without login.
