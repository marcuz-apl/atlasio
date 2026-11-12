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

## Volve subsurface package

`scripts/fetch-demo-volve.mjs` stages a curated, real Volve field package for the data types that the header-only slice cannot exercise. It writes under `demo-data/volve/` (ignored by git), resumes interrupted downloads from `.part` files, and records source URL, licence, byte count, and SHA-256 for every file in `manifest.json`.

| Data | Source | Files | Size |
| --- | --- | ---: | ---: |
| Well headers | Sodir FactMaps layer 201, field `VOLVE` | 27 wellbores (GeoJSON + CSV) | 133 KiB |
| Well logs | OSDU Volve open test data, `volve/welllogs/` | 28 LAS files | 95 MiB |
| Deviation surveys | OSDU Volve open test data, `volve/trajectories/` | 2 NPD CSV files | 48 KiB |
| Production | Sodir FactPages monthly field production | 114 `VOLVE` rows plus the unfiltered source CSV | 1.9 MiB |
| 2D seismic | OSDU Volve open test data, `volve/seismic/st0299/` | 5 SEG-Y lines, navigation, readme | 60 MiB |
| 3D seismic | OSDU Volve open test data, `volve/seismic/st0202/stacks/` | post-stack time cube and order/header summary | 265 MiB |

```sh
node scripts/fetch-demo-volve.mjs --dataset all
node scripts/fetch-demo-volve.mjs --dataset logs,deviation --force
node scripts/fetch-demo-volve.mjs --dataset 2d --all-2d
node scripts/fetch-demo-volve.mjs --dataset 3d --with-depth
node scripts/fetch-demo-volve.mjs --dataset all --dry-run
```

Key endpoints:

- OSDU Volve bucket: `https://s3.amazonaws.com/osdu-seismic-test-data?list-type=2&prefix=volve/`
- Sodir wellbores: `https://factmaps.sodir.no/api/rest/services/Factmaps/FactMapsWGS84/FeatureServer/201/query`
- Sodir field production: `https://factpages.sodir.no/public?/Factpages/external/tableview/field_production_monthly&rs:Format=CSV`

The default 2D set is lines ST0299-05002 through ST0299-05006; `--all-2d` fetches all 33 lines. The default 3D cube is the 4 ms post-stack time volume; `--with-depth` adds the 895 MiB ED50 depth cube. The trajectory `NPD-3145.csv` is Volve well 15/9-19 A; `NPD-8267.csv` is 35/8-U-1 from the same OSDU release and is a second trajectory sample, not a Volve well. Production is field-level and monthly, not per-well.

Coordinate and licence notes: well headers are WGS 84 (`EPSG:4326`); the 2D and 3D SEG-Y volumes are ED50 / UTM zone 31N (`EPSG:23031`); trajectories are ED50 geographic (`EPSG:4230`); LAS files are measured-depth curves without a horizontal CRS. No transformation is applied. Volve subsurface files use the Equinor Open Data Licence; Sodir headers and production use NLOD 2.0. Keep the source and licence fields with the files.

The current ingest API still accepts one well-header JSON and one original file up to 5 MiB, with an explicit `EPSG:4326` position. These raw logs, SEG-Y volumes, and production series are staged for forthcoming features; the downloader does not load them into the database.

## NSTA open-data package

`scripts/fetch-demo-nsta.mjs` stages the openly downloadable part of the UK NSTA collection under `demo-data/nsta/`. It needs `unzip` on `PATH` for the CGG archive, resumes the archive download from `.part`, and records SHA-256 provenance in `manifest.json`.

| Data | Source | Contents | Size |
| --- | --- | --- | ---: |
| Well headers | NSTA UKCS top holes, `OPEN_DATA='Y'` | 13,367 WGS84 wellbores plus 13,367 native ED50 wellbores (GeoJSON/CSV and Esri JSON/CSV) | 23.4 MiB |
| Production | NSTA PPRS field-month points (WGS84) | 136,201 rows, 556 fields, June 1975 to August 2026 | 5.6 MiB |
| Logs | NSTA CGG Additional JDWLs | 28 LAS files | 111.5 MiB |
| Deviation | NSTA CGG Additional JDWLs | 48 deviation documents (XLSX/XLS/TIF/PDF/CSV) | 156.9 MiB |
| 2D seismic index | NSTA NDR 2D SDS line index | 200 line records, native EPSG:4230 Esri JSON | 820 KiB |
| 3D seismic index | NSTA NDR 3D outline index | 716 survey outlines, native EPSG:4230 Esri JSON | 36 MiB |

```sh
node scripts/fetch-demo-nsta.mjs --dataset all
node scripts/fetch-demo-nsta.mjs --dataset wells,production
node scripts/fetch-demo-nsta.mjs --dataset logs,deviation --force
node scripts/fetch-demo-nsta.mjs --dataset seismic --all-seismic
node scripts/fetch-demo-nsta.mjs --dataset all --dry-run
```

Key endpoints:

- NSTA top holes (WGS84): `https://services-eu1.arcgis.com/OZMfUznmLTnWccBc/arcgis/rest/services/UKCS_offshore_wellbore_top_holes_(WGS84)/FeatureServer/0/query`
- NSTA top holes (ED50): `https://services-eu1.arcgis.com/OZMfUznmLTnWccBc/arcgis/rest/services/UKCS_offshore_wellbore_top_holes_(ED50)/FeatureServer/0/query`
- NSTA PPRS production: `https://services-eu1.arcgis.com/OZMfUznmLTnWccBc/arcgis/rest/services/UKCS_hydrocarbon_field_production_reports_PPRS_points_(WGS84)/FeatureServer/0/query`
- NSTA CGG Additional JDWLs: `https://datanstauthority.blob.core.windows.net/external/DataReleases/CGG/CGG_Additional_JDWLs.zip`
- NSTA 2D line index: `https://services-eu1.arcgis.com/OZMfUznmLTnWccBc/arcgis/rest/services/UKCS_NDR_2D_SDS_seismic_lines_(ED50)/FeatureServer/0/query`
- NSTA 3D outline index: `https://services-eu1.arcgis.com/OZMfUznmLTnWccBc/arcgis/rest/services/UKCS_NDR_3D_SDS_seismic_outlines_(ED50)/FeatureServer/0/query`

The 2D/3D folders contain survey geometry only, not SEG-Y. Raw NSTA offshore SEG-Y lives in the UK National Data Repository at <https://ndr.nstauthority.co.uk/> and needs a free NDR account plus download-access approval; it is not anonymously downloadable like the OSDU Volve bucket. Use the Volve 3D cube for a ready SEG-Y test, or UKOGL for open UK onshore seismic.

The 12 NSTA wells already loaded in Atlasio are CCS wells (Liverpool Bay, Net Zero North Sea, Bacton) with no target field. The CGG logs and deviation documents belong to other UK wells, and the PPRS production is field-level rather than tied to those 12 wells. NSTA open data uses the Open Government Licence v3.0; read the CGG release narrative for any additional terms.

NSTA publishes both WGS 84 and ED50 well-header layers. The package stores both as published: the `.geojson`/`.csv` files use the WGS 84 layer that matches the twelve loaded wells, and the `.ed50.json`/`.ed50.csv` files preserve the native ED50 layer for import-time transformation tests. PPRS production is WGS 84 in the source service. The 2D/3D survey indexes are natively ED50 geographic (`EPSG:4230`) and are kept in that CRS as Esri JSON with an explicit `spatialReference`, not RFC 7946 GeoJSON. No layer has been reprojected.

## Datasets deferred for now

- **Volve full release** — roughly 40,000 files under Equinor's data-sharing licence, normally delivered through Databricks. The curated OSDU subset above is now the local demo; the full package remains out of scope.
- **F3 Netherlands** — a 4.5 GB uncompressed seismic download (7.6 GB unpacked) under CC BY 3.0. Excellent for future seismic work; the current app stores seismic only as an opaque file and cannot display or interpret it.
- **Teapot Dome** — well logs in LAS, tops, and 3D seismic in a tar archive, but its positions are not in WGS84 and the current slice does not transform CRS or parse LAS.
- **NLOG Netherlands** — rich wells, logs, and production, but downloads are manual per well and coordinates are commonly RD (`EPSG:28992`), which would need a verified transformation before publication.
- **NSTA offshore SEG-Y** — raw 2D/3D seismic is held in the NDR behind a free account and download-access approval; the open package carries survey geometry only.
- **Production parser** — Sodir and NSTA production CSVs are staged as evidence, but the app has no production time-series parser or view yet.

## Caveats

- This is real public data, not synthetic fixtures. Keep the source and licence fields intact; do not relabel it.
- Atlasio currently treats each package as one well and one file. A Sodir wellbore is not yet separated from its parent well, and sidetracks appear as their own records.
- `demo-data/` is gitignored. Re-run the fetcher rather than committing bulk downloads.
- Verify licence terms again before a public or commercial demo; the retrieval date recorded in each file is the evidence of what was used.
