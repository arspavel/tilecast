-- +goose Up

-- Deleting a group used to leave its schedule targets, access scopes, running
-- Show-now overrides and pending takeovers behind, so Studio kept naming groups
-- removed long ago. Deletion now clears them; this clears what accumulated.
DELETE FROM schedule_targets t
USING screen_groups g
WHERE t.target_type = 'group' AND t.screen_group_id = g.id AND g.deleted_at IS NOT NULL;

DELETE FROM user_screen_scopes s
USING screen_groups g
WHERE s.scope_type = 'group' AND s.scope_id = g.id AND g.deleted_at IS NOT NULL;

DELETE FROM screen_group_memberships m
USING screen_groups g
WHERE m.screen_group_id = g.id AND g.deleted_at IS NOT NULL;

UPDATE presentation_overrides o
SET stopped_at = now(), stop_reason = 'Группа удалена'
FROM screen_groups g
WHERE o.target_type = 'group' AND o.target_id = g.id
  AND g.deleted_at IS NOT NULL AND o.stopped_at IS NULL;

UPDATE scheduled_takeovers st
SET group_ids = ARRAY(
        SELECT u.gid FROM unnest(st.group_ids) AS u(gid)
        WHERE EXISTS (SELECT 1 FROM screen_groups g WHERE g.id = u.gid AND g.deleted_at IS NULL)),
    updated_at = now()
WHERE st.status = 'scheduled'
  AND EXISTS (
      SELECT 1 FROM unnest(st.group_ids) AS u(gid)
      JOIN screen_groups g ON g.id = u.gid
      WHERE g.deleted_at IS NOT NULL);

UPDATE scheduled_takeovers
SET status = 'cancelled', failure = 'Группа удалена', updated_at = now()
WHERE status = 'scheduled' AND cardinality(group_ids) = 0 AND cardinality(screen_ids) = 0;

-- +goose Down

SELECT 1;
