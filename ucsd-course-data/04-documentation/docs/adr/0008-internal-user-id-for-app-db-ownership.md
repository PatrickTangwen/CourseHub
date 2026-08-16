# Internal User ID For App DB Ownership

Beta-1 App DB records should be owned by an internal `user_id` tied to a Verified UCSD Email, rather than treating a UCSD email local-part as a Yale-style `netId`. Existing inherited code may still use `netId`-named adapters while it is being adapted, but new UCSD identity and ownership logic should use `user_id` plus normalized verified email to avoid baking legacy Yale terminology into saved worksheets, Saved Search, wishlist, and privacy settings.
