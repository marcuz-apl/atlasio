CREATE TABLE IF NOT EXISTS admin_accounts (
    id uuid PRIMARY KEY,
    username text NOT NULL UNIQUE,
    role text NOT NULL CHECK (role IN ('admin', 'datamgr')),
    password_hash text NOT NULL,
    must_change_password boolean NOT NULL DEFAULT true,
    mfa_secret text,
    mfa_enabled boolean NOT NULL DEFAULT false,
    mfa_recovery_hashes jsonb NOT NULL DEFAULT '[]'::jsonb,
    failed_attempts integer NOT NULL DEFAULT 0,
    locked_until timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    password_changed_at timestamptz,
    last_login_at timestamptz
);

CREATE TABLE IF NOT EXISTS auth_sessions (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES admin_accounts(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS auth_sessions_account_idx ON auth_sessions (account_id);
CREATE INDEX IF NOT EXISTS auth_sessions_expiry_idx ON auth_sessions (expires_at);
