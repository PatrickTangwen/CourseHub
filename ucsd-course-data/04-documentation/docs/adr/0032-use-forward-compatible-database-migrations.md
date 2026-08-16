# Use Forward Compatible Database Migrations

Hosted App DB changes will use forward-only expand-and-contract migrations so the previous and next Worker versions can coexist with the migrated schema during the rollback window. Application rollback returns Worker and frontend code to a known deployment without automatically running destructive database down migrations; later contract migrations remove old structures only after backfill, compatibility, backup, and explicit approval evidence is complete.
