# Open-data demo wells

Atlasio's current slice ingests well headers, not logs, seismic, or production series. A package is one well, one original file, an explicit `EPSG:4326` position, source and license text, and a maximum file size of 5 MiB. That constraint decides which public datasets are useful now.

## Recommended pair

| Source | What it gives | Access | License |
| --- | --- | --- | --- |
| **Sodir FactMaps WGS84, layer 201** (Norway) | Wellbore name, NPDID, operator, field, discovery, purpose, status, content, type, dates, total and vertical depth, water depth, maximum inclination, point geometry | Anonymous ArcGIS REST query; no key, no registration | NLOD 2.0 |
| **NSTA UKCS wellbore top holes (WGS84)** (United Kingdom) | Well registration number, name, intent, deviation type, operational status, operator, target field, dates, depths, point geometry | Anonymous CSV, GeoJSON, or ArcGIS REST; no key | Open Government Licence v3.0 |

Both publish WGS84 (`EPSG:4326`) point geometry, so no transformation is implied or skipped. Norway supplies a large, varied set; the UK supplies the second country needed to catch local assumptions.

Key endpoints:

- Sodir wellbores: `https://factmaps.sodir.no/api/rest/services/Factmaps/FactMapsWGS84/FeatureServer/201/query`
- NSTA top holes: `https://services-eu1.arcgis.com/OZMfUznmLTnWccBc/arcgis/rest/services/UKCS_offshore_wellbore_top_holes_(WGS84)/FeatureServer/0/query`
- Sodir catalogue: <https://factpages.sodir.no/en/wellbore>
- NSTA portal: <https://open-data-ukcs-transition.hub.arcgis.com/>

## Load the demo set

The fetcher writes one source record per well under `demo-data/` (ignored by git) and can publish them through the importer and reviewer roles:

```sh
node scripts/fetch-demo-wells.mjs --limit 12            # fetch only
node scripts/fetch-demo-wells.mjs --limit 12 --stage    # stage, submit, publish
```

It resolves the demo keys from `GET /api/demo-profiles`, skips wells already present by external ID, and records the source URL, retrieval timestamp, licence, and the full source feature in each well's original file. The manifest uses the well name, NPDID or registration number as the external ID, the field or discovery as an alias, and the licence text.

What the 24-well set exercises: staging, QC, submit, review, publication, alias search, map placement, record detail, original-file download, role visibility, and checksums. It does not exercise log, tops, deviation-survey, seismic, production, or culture ingestion because those are not implemented yet.

## Datasets deferred for now

- **Volve** — the most complete field package, but roughly 40,000 files delivered through Databricks, with an Equinor data-sharing licence. Too heavy for a Repeatable local demo and not directly downloadable as a clean archive.
- **F3 Netherlands** — a 4.5 GB uncompressed seismic download (7.6 GB unpacked) under CC BY 3.0. Excellent for future seismic work; the current app stores seismic only as an opaque file and cannot display or interpret it.
- **Teapot Dome** — well logs in LAS, tops, and 3D seismic in a tar archive, but its positions are not in WGS84 and the current slice does not transform CRS or parse LAS.
- **NLOG Netherlands** — rich wells, logs, and production, but downloads are manual per well and coordinates are commonly RD (`EPSG:28992`), which would need a verified transformation before publication.
- **Production series** — Sodir's ArcGIS API does not expose monthly production; Norwegianpetroleum.no and NSTA publish CSV histories. The app has no production parser or time-series view yet, so these would be stored evidence only.

## Caveats

- This is real public data, not synthetic fixtures. Keep the source and licence fields intact; do not relabel it.
- Atlasio currently treats each package as one well and one file. A Sodir wellbore is not yet separated from its parent well, and sidetracks appear as their own records.
- `demo-data/` is gitignored. Re-run the fetcher rather than committing bulk downloads.
- Verify licence terms again before a public or commercial demo; the retrieval date recorded in each file is the evidence of what was used.
