-- Схема пилотного контура Seamless Handoff (PostgreSQL 15+).
-- Демо работает на Redis; схема задаёт целевую систему записи.

CREATE TABLE IF NOT EXISTS users (
    user_id        TEXT PRIMARY KEY,
    segment        TEXT NOT NULL DEFAULT 'standard',
    phone_masked   TEXT,
    email_masked   TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS devices (
    device_id      TEXT PRIMARY KEY,
    user_id        TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    channel        TEXT NOT NULL CHECK (channel IN ('web', 'mobile')),
    name           TEXT NOT NULL,
    trusted        BOOLEAN NOT NULL DEFAULT false,
    last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS operations (
    op_id          TEXT PRIMARY KEY,
    user_id        TEXT NOT NULL REFERENCES users(user_id),
    product        TEXT NOT NULL DEFAULT 'transfer',
    status         TEXT NOT NULL CHECK (status IN ('draft', 'submitted', 'cancelled', 'expired')),
    amount         NUMERIC(18, 2),
    currency       CHAR(3) NOT NULL DEFAULT 'RUB',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    submitted_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS drafts (
    op_id          TEXT NOT NULL REFERENCES operations(op_id) ON DELETE CASCADE,
    version        INTEGER NOT NULL,
    fields         JSONB NOT NULL DEFAULT '{}'::jsonb,
    context        JSONB NOT NULL DEFAULT '{}'::jsonb,
    lease_device   TEXT REFERENCES devices(device_id),
    lease_until    TIMESTAMPTZ,
    updated_by     TEXT,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (op_id, version)
);

CREATE TABLE IF NOT EXISTS handoff_tickets (
    jti            TEXT PRIMARY KEY,
    op_id          TEXT NOT NULL REFERENCES operations(op_id) ON DELETE CASCADE,
    user_id        TEXT NOT NULL REFERENCES users(user_id),
    code_hash      TEXT NOT NULL,
    issued_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at     TIMESTAMPTZ NOT NULL,
    redeemed_at    TIMESTAMPTZ,
    redeemed_by    TEXT REFERENCES devices(device_id),
    status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'redeemed', 'expired', 'revoked'))
);

CREATE TABLE IF NOT EXISTS audit_events (
    event_id       BIGSERIAL PRIMARY KEY,
    event_uid      TEXT NOT NULL UNIQUE,
    occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    type           TEXT NOT NULL,
    actor_user     TEXT,
    actor_role     TEXT,
    actor_device   TEXT,
    op_id          TEXT,
    outcome        TEXT NOT NULL DEFAULT 'success',
    meta           JSONB NOT NULL DEFAULT '{}'::jsonb,
    prev_hash      TEXT NOT NULL,
    hash           TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS consents (
    consent_id     TEXT PRIMARY KEY,
    user_id        TEXT NOT NULL REFERENCES users(user_id),
    document       TEXT NOT NULL,
    version        TEXT NOT NULL,
    granted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS webhooks (
    hook_id        TEXT PRIMARY KEY,
    url            TEXT NOT NULL,
    secret_hash    TEXT NOT NULL,
    events         TEXT[] NOT NULL,
    active         BOOLEAN NOT NULL DEFAULT true,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS experiments (
    experiment_id  TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    variants       JSONB NOT NULL,
    metric         TEXT NOT NULL,
    started_at     TIMESTAMPTZ,
    finished_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_operations_user ON operations(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_drafts_updated ON drafts(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_op ON handoff_tickets(op_id);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_op ON audit_events(op_id);

-- Аудит неизменяем: запрещаем UPDATE/DELETE на уровне триггера.
CREATE OR REPLACE FUNCTION audit_immutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_events is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_immutable ON audit_events;
CREATE TRIGGER trg_audit_immutable
    BEFORE UPDATE OR DELETE ON audit_events
    FOR EACH ROW EXECUTE FUNCTION audit_immutable();
