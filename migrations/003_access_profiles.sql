CREATE TABLE IF NOT EXISTS access_profiles (
    id uuid PRIMARY KEY,
    role text NOT NULL CHECK (role IN ('reader', 'importer', 'reviewer', 'admin', 'datamgr')),
    label text NOT NULL,
    kind text NOT NULL CHECK (kind IN ('demo', 'custom')),
    demo_key text,
    key_hash text,
    key_prefix text,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    rotated_at timestamptz,
    last_used_at timestamptz,
    created_by text,
    CHECK (
        (kind = 'demo' AND demo_key IS NOT NULL) OR
        (kind = 'custom' AND key_hash IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS access_profiles_demo_key_key
    ON access_profiles (demo_key) WHERE demo_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS access_profiles_key_hash_key
    ON access_profiles (key_hash) WHERE key_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS access_profiles_role_idx ON access_profiles (role);

INSERT INTO access_profiles (id, role, label, kind, demo_key, key_prefix, created_by)
SELECT gen_random_uuid(), seed.role, seed.label, 'demo', seed.key, left(seed.key, 8), 'bootstrap'
FROM (
    VALUES
        ('reader', 'Viewer demo', 'reader-demo'),
        ('importer', 'Importer demo', 'importer-demo'),
        ('reviewer', 'Reviewer demo', 'reviewer-demo')
) AS seed(role, label, key)
WHERE NOT EXISTS (SELECT 1 FROM access_profiles WHERE kind = 'demo');
