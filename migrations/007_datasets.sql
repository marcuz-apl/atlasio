CREATE TABLE IF NOT EXISTS seismic_surveys (
    id uuid PRIMARY KEY,
    name text NOT NULL,
    kind text NOT NULL CHECK (kind IN ('2d', '3d')),
    source_crs text NOT NULL,
    footprint geometry(Polygon, 0) NOT NULL,
    display_footprint geometry(Polygon, 4326),
    license text NOT NULL,
    confidentiality text NOT NULL DEFAULT 'restricted',
    status text NOT NULL DEFAULT 'published',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS datasets (
    id uuid PRIMARY KEY,
    well_id uuid REFERENCES wells(id),
    survey_id uuid REFERENCES seismic_surveys(id),
    kind text NOT NULL,
    format text NOT NULL,
    source_crs text,
    object_key text NOT NULL,
    original_name text NOT NULL,
    sha256 text,
    size_bytes bigint,
    license text NOT NULL,
    confidentiality text NOT NULL DEFAULT 'restricted',
    status text NOT NULL DEFAULT 'staged',
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (well_id IS NOT NULL OR survey_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS datasets_well_idx ON datasets (well_id);
CREATE INDEX IF NOT EXISTS datasets_survey_idx ON datasets (survey_id);

CREATE OR REPLACE FUNCTION forbid_published_dataset_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status = 'published' THEN
        RAISE EXCEPTION 'Published datasets are immutable';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER published_datasets_immutable
    BEFORE UPDATE OR DELETE ON datasets
    FOR EACH ROW EXECUTE FUNCTION forbid_published_dataset_change();

CREATE OR REPLACE FUNCTION forbid_published_survey_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status = 'published' THEN
        RAISE EXCEPTION 'Published seismic surveys are immutable';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER published_surveys_immutable
    BEFORE UPDATE OR DELETE ON seismic_surveys
    FOR EACH ROW EXECUTE FUNCTION forbid_published_survey_change();