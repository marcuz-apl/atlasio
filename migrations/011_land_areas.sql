-- Governed land areas: concession, licence, block, lease, and interest polygons.
-- Source geometry is preserved in its native CRS, and the WGS 84 display
-- geometry is derived only when the CRS engine supports a registered
-- transformation.

CREATE TABLE IF NOT EXISTS land_areas (
    id uuid PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN ('concession', 'licence', 'block', 'lease', 'interest_area', 'other')),
    code text NOT NULL,
    name text,
    block_ref text,
    operator text,
    parties jsonb NOT NULL DEFAULT '[]'::jsonb,
    licence_status text,
    effective_from date,
    effective_to date,
    source text NOT NULL,
    source_url text,
    source_crs text NOT NULL,
    footprint geometry(Polygon, 0) NOT NULL,
    display_footprint geometry(Polygon, 4326),
    license text NOT NULL,
    confidentiality text NOT NULL DEFAULT 'restricted',
    status text NOT NULL DEFAULT 'published',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS land_areas_identity_idx
    ON land_areas (kind, code, coalesce(block_ref, ''));

CREATE INDEX IF NOT EXISTS land_areas_footprint_gix ON land_areas USING gist (footprint);
CREATE INDEX IF NOT EXISTS land_areas_display_gix ON land_areas USING gist (display_footprint);

CREATE OR REPLACE FUNCTION forbid_published_land_area_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status = 'published' THEN
        RAISE EXCEPTION 'Published land areas are immutable';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER published_land_areas_immutable
    BEFORE UPDATE OR DELETE ON land_areas
    FOR EACH ROW EXECUTE FUNCTION forbid_published_land_area_change();
