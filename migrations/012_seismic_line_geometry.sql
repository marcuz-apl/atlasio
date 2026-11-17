-- Seismic surveys can now carry line geometry for 2D lines as well as
-- polygons for 3D survey outlines. Source geometry stays in its native CRS
-- and the WGS 84 display geometry is derived only for registered CRSs.

ALTER TABLE seismic_surveys
    ALTER COLUMN footprint TYPE geometry(Geometry, 0)
    USING footprint::geometry;

ALTER TABLE seismic_surveys
    ALTER COLUMN display_footprint TYPE geometry(Geometry, 4326)
    USING display_footprint::geometry;

ALTER TABLE seismic_surveys ADD COLUMN IF NOT EXISTS operator text;
ALTER TABLE seismic_surveys ADD COLUMN IF NOT EXISTS attributes jsonb NOT NULL DEFAULT '{}'::jsonb;
