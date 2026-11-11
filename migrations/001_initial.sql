CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE wells (
    id uuid PRIMARY KEY,
    current_version_id uuid,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE import_batches (
    id uuid PRIMARY KEY,
    status text NOT NULL CHECK (status IN ('staged', 'submitted', 'published', 'rejected')),
    manifest jsonb NOT NULL,
    qc jsonb NOT NULL,
    submitted_at timestamptz,
    reviewed_at timestamptz,
    reviewer text,
    review_reason text,
    well_id uuid REFERENCES wells(id),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE file_assets (
    id uuid PRIMARY KEY,
    batch_id uuid NOT NULL UNIQUE REFERENCES import_batches(id),
    original_name text NOT NULL,
    object_key text NOT NULL UNIQUE,
    sha256 text NOT NULL,
    size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
    license text NOT NULL,
    confidentiality text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE well_versions (
    id uuid PRIMARY KEY,
    well_id uuid NOT NULL REFERENCES wells(id),
    version_no integer NOT NULL CHECK (version_no > 0),
    batch_id uuid NOT NULL UNIQUE REFERENCES import_batches(id),
    name text NOT NULL,
    aliases text[] NOT NULL DEFAULT '{}',
    external_id text,
    source text NOT NULL,
    source_crs text NOT NULL,
    source_x double precision NOT NULL,
    source_y double precision NOT NULL,
    display_point geometry(Point, 4326) NOT NULL,
    transform_operation text NOT NULL,
    reviewer text NOT NULL,
    published_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (well_id, version_no)
);

ALTER TABLE wells ADD CONSTRAINT wells_current_version_fk
    FOREIGN KEY (current_version_id) REFERENCES well_versions(id);

CREATE INDEX well_versions_display_point_gix ON well_versions USING gist (display_point);
CREATE INDEX well_versions_aliases_gin ON well_versions USING gin (aliases);

CREATE TABLE audit_events (
    id bigserial PRIMARY KEY,
    batch_id uuid REFERENCES import_batches(id),
    actor text NOT NULL,
    action text NOT NULL,
    details jsonb NOT NULL DEFAULT '{}',
    occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION forbid_version_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Published well versions are immutable';
END;
$$;

CREATE TRIGGER well_versions_immutable
    BEFORE UPDATE OR DELETE ON well_versions
    FOR EACH ROW EXECUTE FUNCTION forbid_version_change();
