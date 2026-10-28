-- +goose Up

-- Command retention deletes completed player commands after the configured
-- number of days, but a screen's status still pointed at its last command and
-- the plain foreign keys refused the delete, so retention failed on every run
-- and old commands were never removed. The status only remembers the last
-- command as a convenience; when the command itself is gone, forget it.
ALTER TABLE screen_player_status
    DROP CONSTRAINT screen_player_status_last_command_id_fkey,
    ADD CONSTRAINT screen_player_status_last_command_id_fkey
        FOREIGN KEY (last_command_id) REFERENCES player_commands(id) ON DELETE SET NULL,
    DROP CONSTRAINT screen_player_status_display_control_last_command_id_fkey,
    ADD CONSTRAINT screen_player_status_display_control_last_command_id_fkey
        FOREIGN KEY (display_control_last_command_id) REFERENCES player_commands(id) ON DELETE SET NULL;

-- +goose Down

ALTER TABLE screen_player_status
    DROP CONSTRAINT screen_player_status_last_command_id_fkey,
    ADD CONSTRAINT screen_player_status_last_command_id_fkey
        FOREIGN KEY (last_command_id) REFERENCES player_commands(id),
    DROP CONSTRAINT screen_player_status_display_control_last_command_id_fkey,
    ADD CONSTRAINT screen_player_status_display_control_last_command_id_fkey
        FOREIGN KEY (display_control_last_command_id) REFERENCES player_commands(id);
