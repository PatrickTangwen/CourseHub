# Defer The Hosted Shadow Course Data Platform

The first hosted staging environment will deploy only the user-facing App path: the frontend, Core App Backend, App DB, session store, and Published Snapshot serving. The Course Data Store and Hasura remain a locally validated shadow path until hosted shadow-query evidence is needed; this keeps the first hosted login acceptance small and near-free without reversing ADR 0024 or changing the Published Snapshot source-of-truth boundary.
