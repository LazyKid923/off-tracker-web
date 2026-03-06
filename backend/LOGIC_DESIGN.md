# Off Tracker Backend Logic Design

This defines a production backend write model that preserves current behavior in `Code.js` and guarantees that all additions, edits, deletions, and undo actions are stored.

## 1) Core Design

- Source of truth: PostgreSQL.
- Write model: transactional service methods.
- Audit model: immutable append-only `audit_events` rows for every mutation.
- Read model: normal tables (`personnel`, `off_grants`, `off_usages`, `off_usage_allocations`) with soft-delete markers where needed.
- Concurrency: lock grant rows during allocation (`SELECT ... FOR UPDATE`) to prevent double-spend.

## 2) Invariants (Must Always Hold)

- Personnel name is unique case-insensitively.
- At least one active personnel exists.
- Grant duration is only `0.5` or `1.0`.
- Usage duration is only `0.5` or `1.0` (`FULL=1.0`, `AM/PM=0.5`).
- For every grant: `used_value >= 0`, `remaining_value >= 0`, `used_value + remaining_value = duration_value`.
- `off_usage_allocations.amount > 0`.
- Sum of allocations per usage equals `off_usages.duration_used`.
- Deleted grant is blocked if `used_value > 0`.
- Undo usage restores exactly what that usage allocated.
- Every mutation writes exactly one `audit_events` entry (with before/after snapshots).

## 3) Mutation Workflows

## `addGrant()`
- Validate date, duration type, reason type and reason-specific fields.
- Insert grant with `used_value=0`, `remaining_value=duration`, status `UNUSED`.
- Write audit event `GRANT_CREATED`.

## `useOff()`
- Validate target duration and selected grant IDs.
- Lock selected grants (`FOR UPDATE`) scoped to personnel.
- Verify selected remaining total covers target.
- Allocate in selected order until target is reached.
- Update each touched grant (`used_value`, `remaining_value`, `status`).
- Insert usage and allocation rows.
- Write audit event `USAGE_CREATED` with allocation snapshot.

## `editGrant()`
- Lock target grant row.
- Validate new duration/reason rules.
- Reject if `new_duration < used_value`.
- Recompute `remaining_value` and `status`.
- Update row.
- Write audit event `GRANT_UPDATED`.

## `deleteGrantBatch()`
- Lock candidate grants.
- Reject any grant with `used_value > 0`.
- Soft-delete grants.
- Write one audit event `GRANT_DELETED_BATCH`.

## `editUsage()`
- Lock usage row and all grants touched by existing allocations.
- Compute `delta = target_duration - current_duration`.
- If `delta > 0`: lock additional grants, allocate extra.
- If `delta < 0`: release from allocation tail (reverse order), restoring grants.
- Upsert allocations, update usage row.
- Recompute touched grants and persist.
- Write audit event `USAGE_UPDATED`.

## `undoUsage()`
- Lock usage and all referenced grants.
- Restore each allocation amount back to grants.
- Mark usage `undone_at`, `undone_by` (do not hard-delete).
- Mark allocations `reversed_at`.
- Write audit event `USAGE_UNDONE`.

## `deletePersonnel(deleteData=false|true)`
- Lock personnel row.
- If `deleteData=false`, reject when related active grants/usages/logical records exist.
- If `deleteData=true`, soft-delete related grants/usages/allocations, then personnel.
- Reject if this would remove last active personnel.
- Write audit event `PERSONNEL_DELETED`.

## 4) Audit Event Contract

Each mutation appends one row:

- `event_type`: one of `PERSONNEL_CREATED|PERSONNEL_DELETED|GRANT_CREATED|GRANT_UPDATED|GRANT_DELETED_BATCH|USAGE_CREATED|USAGE_UPDATED|USAGE_UNDONE`.
- `actor_id`, `actor_email`.
- `personnel_id` (nullable when global).
- `record_type`, `record_id`.
- `summary` (human-readable).
- `before_json` and `after_json` (JSONB snapshots).
- `request_id` for API trace correlation.
- `created_at` immutable timestamp.

`audit_events` is append-only: no updates/deletes by app role.

## 5) Error Semantics

Return deterministic validation errors:

- Invalid date format: `YYYY-MM-DD required`.
- Invalid session/duration/reason enum.
- Selected grant ID missing or no remaining balance.
- Insufficient selected balance for required duration.
- Cannot reduce grant duration below already used amount.
- Cannot delete grant with used amount.
- Cannot delete personnel without `deleteData=true` when related data exists.

## 6) Verification Matrix (Minimum)

- Add grant: OPS weekend required + OTHERS details required.
- Use off 0.5 and 1.0 across one or many grants.
- Use off fails on insufficient balance.
- Edit usage increase with additional grants.
- Edit usage decrease releases from tail allocations.
- Undo usage fully restores grant balances.
- Batch delete grant rejects when one grant has usage.
- Delete personnel rejects as last active personnel.
- Concurrent use requests on same grant do not over-allocate.
- Every successful mutation creates one audit event with before/after payloads.

