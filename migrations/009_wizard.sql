-- Wizard slice A: allow one header table to carry many well packages.
-- Drop the UNIQUE constraints on batch_id / object_key so a single
-- ingest table can fan out into multiple import_batches rows.

ALTER TABLE well_versions DROP CONSTRAINT IF EXISTS well_versions_batch_id_key;
ALTER TABLE file_assets   DROP CONSTRAINT IF EXISTS file_assets_batch_id_key;
ALTER TABLE file_assets   DROP CONSTRAINT IF EXISTS file_assets_object_key_key;

CREATE TABLE IF NOT EXISTS ingest_tables (
    id          uuid PRIMARY KEY,
    name        text NOT NULL,
    format      text NOT NULL CHECK (format IN ('csv', 'xlsx')),
    profile     jsonb NOT NULL,
    rules       jsonb NOT NULL,
    defaults    jsonb NOT NULL,
    mapping     jsonb NOT NULL,
    object_key  text NOT NULL UNIQUE,
    sha256      text NOT NULL,
    size_bytes  bigint NOT NULL CHECK (size_bytes >= 0),
    license     text NOT NULL,
    confidentiality text NOT NULL,
    status      text NOT NULL DEFAULT 'staged'
                CHECK (status IN ('staged', 'staged_partial', 'rejected')),
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ingest_table_rows (
    id          bigserial PRIMARY KEY,
    table_id    uuid NOT NULL REFERENCES ingest_tables(id) ON DELETE CASCADE,
    row_index   integer NOT NULL CHECK (row_index >= 0),
    manifest    jsonb NOT NULL,
    qc          jsonb NOT NULL,
    blocked     boolean NOT NULL DEFAULT false,
    changes     jsonb NOT NULL DEFAULT '[]',
    batch_id    uuid,
    UNIQUE (table_id, row_index)
);

CREATE INDEX ingest_table_rows_batch_id_idx ON ingest_table_rows (batch_id);
CREATE INDEX ingest_table_rows_table_id_idx ON ingest_table_rows (table_id);
