# Use One Origin For The First Hosted Staging Environment

The first hosted staging environment will expose the React frontend, Published Snapshot routes, and App Backend API from `staging.sungridplanner.com`, with API routes under `/api/*`. A single browser origin reduces CORS, credential, and secure-cookie failure modes during hosted login acceptance; a separate public API origin can be introduced later if a non-browser consumer requires it.
