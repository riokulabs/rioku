-- Reverse migration 000052: restore NOT NULL constraint on memberships.user_id.
-- Any pending memberships (user_id IS NULL) must be removed first.

PRAGMA foreign_keys=OFF;

DELETE FROM memberships WHERE user_id IS NULL;

CREATE TABLE memberships_old (
    id               TEXT PRIMARY KEY,
    tenant_id        TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id          TEXT NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
    state            TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('pending','active','deactivated','removed')),
    invited_by       TEXT,
    invited_at       TEXT,
    joined_at        TEXT,
    invite_token_hash TEXT,
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO memberships_old
    SELECT id, tenant_id, user_id, state, invited_by, invited_at, joined_at, invite_token_hash, created_at, updated_at
    FROM memberships;

DROP TABLE memberships;
ALTER TABLE memberships_old RENAME TO memberships;

CREATE INDEX idx_memberships_tenant ON memberships (tenant_id);
CREATE INDEX idx_memberships_user   ON memberships (user_id);
CREATE INDEX idx_memberships_state  ON memberships (state);

PRAGMA foreign_keys=ON;
