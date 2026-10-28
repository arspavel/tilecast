-- +goose Up

-- The asset tag stuck on the device, so a technician standing in front of a
-- screen can match it to its record. It is shown with the screen name in the
-- player's service overlay.
ALTER TABLE screens ADD COLUMN inventory_number TEXT NOT NULL DEFAULT '';

-- +goose Down

ALTER TABLE screens DROP COLUMN inventory_number;
