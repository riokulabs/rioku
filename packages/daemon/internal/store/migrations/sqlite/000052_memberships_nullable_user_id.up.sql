-- Migration 000052: make memberships.user_id nullable
-- Pending invites are stored without a user_id until accepted.
-- SQLite does not support DROP NOT NULL so we must recreate the table.

PRAGMA foreign_keys=OFF;

CREATE TABLE memberships_new (
    id               TEXT PRIMARY KEY,
    tenant_id        TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id          TEXT REFERENCES users(id) ON DELETE CASCADE,
    state            TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('pending','active','deactivated','removed')),
    invited_by       TEXT,
    invited_at       TEXT,
    joined_at        TEXT,
    invite_token_hash TEXT,
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO memberships_new
    SELECT id, tenant_id, user_id, state, invited_by, invited_at, joined_at, invite_token_hash, created_at, updated_at
    FROM memberships;

DROP TABLE memberships;
ALTER TABLE memberships_new RENAME TO memberships;

CREATE INDEX idx_memberships_tenant ON memberships (tenant_id);
CREATE INDEX idx_memberships_user   ON memberships (user_id);
CREATE INDEX idx_memberships_state  ON memberships (state);

PRAGMA foreign_keys=ON;
