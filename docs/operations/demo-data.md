# Open-data demo wells

Atlasio's current slice ingests well headers, not logs, seismic, or production series. A package is one well, one original file, a source position in a supported CRS (`EPSG:4326`, or native ED50 `EPSG:4230` / `23031` / `23032` reprojected for display), source and license text, and a maximum file size of 5 MiB. That constraint decides which public datasets are useful now.

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

## Sodir open-data package

`scripts/fetch-demo-sodir.mjs` stages the openly published Sodir data under `demo-data/sodir/` (ignored by git). It reads the two FactMaps services (WGS 84 and native ED50 / UTM zone 32N) and the DataService FeatureServer in native ED50 geographic. The script pages through every feature layer and attribute table, retries transient errors, skips complete files, and records SHA-256 provenance in `manifest.json`. The full package is 839 files, about 1.9 GiB.

| Data | Source | Contents | Size |
| --- | --- | --- | ---: |
| Wellbores | FactMaps layer 201; DataService layer 5000 | 9,876 wellbores in each of the three services (GeoJSON/CSV in WGS 84; Esri JSON/CSV in ED50 / UTM 32N and ED50 geographic) | 125.0 MiB |
| FactMaps layers | FactMaps, all 68 layers per service | Wellbores, facilities, pipelines, surveys, fields, discoveries, plays, production and CO2 licences, blocks, quadrants, faults, structural elements, licence documents | 1.0 GiB |
| DataService layers | DataService, all 39 layers | Source-database layers for blocks, quadrants, licences and licence history, seismic acquisition, wellbores, facilities, discoveries, fields, and plays | 375.2 MiB |
| FactMaps tables | FactMaps, all 29 tables | 20,105 log records, 8,758 casing/leak-off records, 1,187 DST records, 36,761 mud records, 103,922 palynology slides, 1,073 oil samples, plus companies, field history/reserves, licence operators, tasks, transfers, and licensees | 3.7 MiB |
| DataService tables | DataService, all 73 tables | 41,537 stratigraphy intervals, 41,537 formation tops, 8,544 cores, 22,489 core photos, 2,311 cuttings, 3,919 thin sections, 10,569 well documents, 101,820 seismic-acquisition polygons, 44,068 progress notes, 32,434 profiles, and the petroleum register | 508.2 MiB |
| Production | FactPages | 28,562 monthly field rows (June 1971 to August 2026) and 2,417 yearly rows | 2.1 MiB |

```sh
node scripts/fetch-demo-sodir.mjs --dataset all
node scripts/fetch-demo-sodir.mjs --dataset layers --service wgs84
node scripts/fetch-demo-sodir.mjs --dataset layers,tables --service data
node scripts/fetch-demo-sodir.mjs --dataset tables
node scripts/fetch-demo-sodir.mjs --dataset production
node scripts/fetch-demo-sodir.mjs --dataset layers --only 5000 --service data --force
node scripts/fetch-demo-sodir.mjs --dataset all --dry-run
```

Key endpoints:

- FactMaps WGS 84: `https://factmaps.sodir.no/api/rest/services/Factmaps/FactMapsWGS84/FeatureServer`
- FactMaps ED50 / UTM 32N: `https://factmaps.sodir.no/api/rest/services/Factmaps/FactMapsED50UTM32/FeatureServer`
- DataService ED50 geographic: `https://factmaps.sodir.no/api/rest/services/DataService/Data/FeatureServer`
- FactPages production monthly: `https://factpages.sodir.no/public?/Factpages/external/tableview/field_production_monthly&rs:Format=CSV`
- FactPages production yearly: `https://factpages.sodir.no/public?/Factpages/external/tableview/field_production_yearly&rs:Format=CSV`
- Sodir open data: <https://www.sodir.no/en/facts/data-and-analyses/open-data/>

Coordinate notes: the WGS 84 service is Sodir's own transformed product (`EPSG:4326`), FactMaps ED50 is kept in native `EPSG:23032`, and DataService is kept in native `EPSG:4230`. The script does not transform any of them. ED50 layers are stored as Esri JSON with an explicit `spatialReference` because a GeoJSON request against those services silently reprojects to WGS 84; GeoJSON is written only for the WGS 84 layers. Tables and production CSVs carry no geometry. The package uses NLOD 2.0.

Sodir does not publish raw SEG-Y. Its open services cover wells, production, surveys, facilities, licences, and subsurface metadata; raw Norwegian seismic is held in Diskos and needs membership or an order through the Diskos public portal. The current ingest API cannot load these layers, tables, or production series yet; the package is staged evidence for forthcoming importers.

## Import-time CRS transformation

The slice no longer requires WGS 84 at the source. `crates/domain/src/crs.rs` implements one verified operation per supported CRS and derives the `EPSG:4326` display position at publication, preserving `source_crs`, `source_x`, and `source_y` unchanged and recording `transform_operation` plus `transform_accuracy_m`.

The registered operation is **EPSG:1311, "ED50 to WGS 84 (18)"** (Position Vector / EPSG:9606, stated accuracy 1.0 m), which PROJ 9.4 ranks best for the southern North Sea (UKCS, Netherlands, Denmark, Norway south of 62N). It covers `EPSG:4230` (ED50 geographic) and, after an inverse Transverse Mercator step, `EPSG:23031` / `EPSG:23032` (ED50 / UTM 31N/32N). `EPSG:4326` is an identity transform.

The engine is pure Rust so the domain crate stays portable and unit-testable without a system PROJ library; PROJ is the offline authority. `fixtures/crs-control-points.json` holds control points generated from the published EPSG:1311 parameters and cross-checked against `cs2cs --area EPSG:2330 --accuracy 1.0`; points where PROJ auto-selects a different operation are excluded. `crates/domain/tests/crs.rs` asserts the engine reproduces those controls to about 1 cm, and `scripts/verify-crs.mjs` stages, publishes, and checks synthetic ED50 wells end to end (source preserved, display transformed, map placement, out-of-area and unregistered CRS blocked).

A position outside the verified area of EPSG:1311 is rejected at QC rather than transformed with an operation that does not apply there. Other regions (for example RMOTC's NAD27/NAD83 or Netherlands RD New `EPSG:28992`) need their own registered operation and control points before they can be published.

## Deferred packages and parsers

Ingest type matrix (2026-11-14): `docs/reports/2026-11-14-ingest-matrix.md` — 27/27 rows pass across Sodir, NSTA, and Volve, including real header publishes, real above-5 MiB streaming originals, restricted-access hiding, and published immutability. RMOTC is on hold by owner decision; its USA NAD27/83 no-transform behaviour is proven by `scripts/verify-datasets.mjs`.

- **Volve full release** — roughly 40,000 files under Equinor's data-sharing licence, normally delivered through Databricks. The curated OSDU subset above is now the local demo; the full package remains out of scope.
- **F3 Netherlands** — a 4.5 GB uncompressed seismic download (7.6 GB unpacked) under CC BY 3.0. Excellent for future seismic work; the app catalogs seismic originals and shows survey footprints but cannot interpret traces.
- **Teapot Dome** — well logs in LAS, tops, and 3D seismic in a tar archive, but its positions are NAD27/83, which have no registered transformation yet, so such headers stay catalog-only until an operation is verified with control points.
- **NLOG Netherlands** — rich wells, logs, and production, but downloads are manual per well and coordinates are commonly RD (`EPSG:28992`), which would need a verified transformation before publication.
- **NSTA offshore SEG-Y** — raw 2D/3D seismic is held in the NDR behind a free account and download-access approval; the open package carries survey geometry only.
- **Sodir raw SEG-Y** — Sodir publishes well, production, survey, and licence data, but not raw seismic. Norwegian SEG-Y is in Diskos; members download it directly and non-members order released data through the Diskos public portal.
- **NSTA CGG remaining releases** — `CGG_Digital_Well_Logs.zip` (15.0 GiB), `Pressure.zip` (11.0 GiB), `CoreAnalysis.zip` (40.9 GiB), `CGG_Seeps_Database.zip` (4.9 GiB), and `CGG_GeoThermal.zip` (1.3 MiB) are openly downloadable from the NSTA blob but not staged; they can now be attached as governed originals, while log, pressure, and core parsing remains out of scope.
- **Production parser** — Sodir and NSTA production CSVs are staged as evidence, but the app has no production time-series parser or view yet.

## Caveats

- This is real public data, not synthetic fixtures. Keep the source and licence fields intact; do not relabel it.
- Atlasio currently treats each package as one well and one file. A Sodir wellbore is not yet separated from its parent well, and sidetracks appear as their own records.
- `demo-data/` is gitignored. Re-run the fetcher rather than committing bulk downloads.
- Verify licence terms again before a public or commercial demo; the retrieval date recorded in each file is the evidence of what was used.
