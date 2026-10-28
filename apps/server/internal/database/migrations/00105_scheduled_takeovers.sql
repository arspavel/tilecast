-- +goose Up

-- A Takeover can be prepared ahead of time: the request is kept here and the
-- server activates it at starts_at through the same path as an immediate
-- Takeover, so players need nothing new and see an ordinary Takeover begin.
CREATE TABLE scheduled_takeovers (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organization_settings(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    playlist_id UUID NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    screen_ids UUID[] NOT NULL DEFAULT '{}',
    group_ids UUID[] NOT NULL DEFAULT '{}',
    starts_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled'
        CHECK (status IN ('scheduled', 'starting', 'activated', 'cancelled', 'failed')),
    takeover_id UUID REFERENCES takeovers(id) ON DELETE SET NULL,
    failure TEXT NOT NULL DEFAULT '',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    cancelled_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (expires_at > starts_at)
);
CREATE INDEX scheduled_takeovers_due_idx ON scheduled_takeovers(starts_at) WHERE status = 'scheduled';

-- +goose Down

DROP TABLE scheduled_takeovers;
