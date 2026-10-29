-- +goose Up

-- The Studio switch "Работать без интернета". TILECAST_OFFLINE on the server
-- still forces offline mode whatever this row says.
CREATE TABLE network_policy (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    offline BOOLEAN NOT NULL DEFAULT FALSE,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO network_policy (singleton) VALUES (TRUE);

-- +goose Down

DROP TABLE network_policy;
