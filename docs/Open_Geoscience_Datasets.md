# Free Public Well, Seismic, and Production Data for Open-Source Software Demos

> **Verified 2026-11-12 for Atlasio.** For the current well-header slice (EPSG:4326, one file up to 5 MiB), use **Sodir FactMaps WGS84 wellbores** (Norway) and **NSTA UKCS top holes WGS84** (United Kingdom). Curated **Volve** and **NSTA** subsets are staged under `demo-data/volve/` and `demo-data/nsta/`, and the full openly published **Sodir** FactMaps/DataService/FactPages collection is staged under `demo-data/sodir/` for log, deviation, production, survey, licence, and CRS testing. None of these packages is ingestible by the header-only API yet. Raw NSTA offshore SEG-Y remains NDR-gated, and raw Norwegian SEG-Y remains in Diskos. F3, Teapot Dome, and NLOG remain deferred until LAS, SEG-Y, or CRS transformation is implemented. The recipes are in [operations/demo-data.md](operations/demo-data.md), `scripts/fetch-demo-wells.mjs`, `scripts/fetch-demo-volve.mjs`, `scripts/fetch-demo-nsta.mjs`, and `scripts/fetch-demo-sodir.mjs`.



## 1- Best Overall Dataset: Volve Field (Equinor)

This is usually the first recommendation for geoscientists.

### Includes
- 3D seismic
- Well logs (LAS)
- Deviation surveys
- Well reports
- Formation tops
- Reservoir models
- Production history
- Injection history
- Pressure data
- Drilling data

The dataset contains roughly 40,000 files from a real producing North Sea field.

### Download
- https://www.equinor.com/energy/volve-data-sharing

### Best for
- Petrel demos
- Reservoir evaluation
- Machine learning
- Production forecasting
- Well-to-seismic tie projects

### Offline access

The full release is still delivered through Databricks or Azure, but the OSDU open test-data bucket exposes a small, anonymously downloadable Volve subset: `https://s3.amazonaws.com/osdu-seismic-test-data?list-type=2&prefix=volve/`. It includes LAS well logs, trajectories, 2D site-survey lines, a 3D post-stack time cube, horizons, checkshots, and markers. `scripts/fetch-demo-volve.mjs` downloads the well headers from Sodir, the logs, trajectories, Volve field production, five 2D lines, and the 3D time cube into `demo-data/volve/` (48 files, about 422 MiB), with SHA-256 provenance.

---

## 1a- Sodir Open Data (Norway)

The Norwegian Offshore Directorate publishes its FactMaps, DataService, and FactPages data as open ArcGIS services. This covers the whole Norwegian Continental Shelf, not just the Volve field.

### Includes
- 9,876 wellbores with headers, dates, depths, operators, fields, discoveries, and fact-page links, published in WGS 84, ED50 / UTM zone 32N, and native ED50 geographic.
- 68 FactMaps feature layers per service: facilities, pipelines, seismic/EM/other surveys, fields, discoveries, plays, production and CO2 licences, licence documents, blocks, quadrants, faults, structural elements, and resource-estimate areas.
- 39 DataService layers: the source-database versions of the block, licence, seismic-acquisition, wellbore, facility, discovery, field, and play layers.
- 102 attribute tables: 41,537 stratigraphy intervals, 41,537 formation tops, 20,105 log records, 8,758 casing/leak-off records, 1,187 DST records, 36,761 mud records, 103,922 palynology slides, 8,544 cores, 22,489 core photos, 2,311 cuttings, 3,919 thin sections, 10,569 well documents, 101,820 seismic-acquisition polygons, 44,068 acquisition progress notes, 32,434 profiles, plus companies, reserves, and the petroleum register.
- 28,562 monthly and 2,417 yearly field-production rows from FactPages, June 1971 to August 2026.

### Local package
`scripts/fetch-demo-sodir.mjs` writes 839 files, about 1.9 GiB, under `demo-data/sodir/`. It keeps all three published coordinate systems: WGS 84 as GeoJSON/CSV, ED50 / UTM zone 32N as Esri JSON/CSV, and DataService ED50 geographic as Esri JSON/CSV. No transformation is applied. The 68 FactMaps layers, 39 DataService layers, and 102 tables are listed in `metadata/inventory.json`.

### Limits
- No raw SEG-Y. Norwegian seismic is in Diskos; members download released data directly and non-members order it through the Diskos public portal.
- The current Atlasio API cannot ingest these files yet.
- Licence: NLOD 2.0.

---

## 1b- NSTA UKCS Open Data (United Kingdom)

The North Sea Transition Authority publishes a broad UKCS open-data collection, but it is not one downloadable field package.

### Freely downloadable
- 13,367 open wellbore top holes in WGS 84, including the twelve NSTA wells already loaded in Atlasio.
- PPRS field-month production points in WGS 84: 136,201 rows covering 556 fields from June 1975 to August 2026.
- CGG releases on the NSTA blob: the Additional JDWLs archive (188 MB) holds the 28 LAS files and 48 deviation documents; the separate digital well-log archive is 15.0 GiB, the pressure database 11.0 GiB, and the core-analysis database 40.9 GiB. All are directly downloadable without a key.
- 2D and 3D NDR survey indexes: line and outline geometry in ED50 (`EPSG:4230`), useful for map display but not raw seismic. The local package keeps the native ED50 coordinates instead of reprojecting them to WGS 84.

### Gated
- Raw offshore 2D and 3D SEG-Y is held in the UK National Data Repository at <https://ndr.nstauthority.co.uk/>. A free account is required, and download access is requested per organisation. The 370 MB `NDR_Seismic_ED50.zip` on the NSTA blob is a shapefile index, not SEG-Y.

### Local package
`scripts/fetch-demo-nsta.mjs` stages the open layers under `demo-data/nsta/` (89 files, about 520 MiB). It keeps both published well-header layers: WGS 84 for the wells already loaded in Atlasio, and native ED50 for conversion tests. Production stays in published WGS 84; the 2D/3D survey indexes stay in native ED50 geographic and are stored as Esri JSON with an explicit spatial reference. The twelve loaded NSTA wells are CCS wells (Liverpool Bay, Net Zero North Sea, Bacton) with no target field, so the CGG logs and deviation documents come from other UK wells and the production is field-level rather than tied to those twelve.

---

## 2- Best Open 3D Seismic Dataset: F3 Netherlands

The famous F3 Block has become the 'MNIST' of seismic interpretation.

### Includes
- 3D seismic cube
- Horizons
- Fault interpretations
- Training labels for AI

### Best for
- Fault interpretation
- Horizon tracking
- Deep learning
- OpendTect tutorials

---



## 3- Teapot Dome (USA)

A classic training dataset used by universities and software vendors.

### Includes
- 3D seismic
- Well logs (LAS)
- Core photographs
- Formation tops
- Horizons
- GIS data

### Best for
- OpendTect
- Seismic attribute analysis
- Structural interpretation
- Carbon storage studies

---



## 4- NLOG Netherlands National Database

One of the richest free petroleum databases in the world.

### Includes
- Well logs
- Well reports
- Core information
- Production data
- Seismic surveys
- Geological maps

### Website
- https://www.nlog.nl/en/data

### Best for
- Real exploration projects
- Production analytics
- Basin studies

---



## 5- SEG Open Data Repository

Contains datasets such as:

- F3 Netherlands
- Penobscot
- Poseidon
- Norne
- Volve
- Teapot Dome
- Marmousi
- Parihaka
- Opunake

### Catalog
- https://wiki.seg.org/wiki/Open_data

---



## 6- OSDU Open Test Data

### Includes
- Wells
- Seismic references
- Geological objects
- Standardized schemas

### Best for
- OSDU deployment
- Cloud workflows
- Data management demonstrations

---



## 7- Norne Field Dataset

### Includes
- Wells
- Seismic
- Production
- Reservoir simulation

### Best for
- Reservoir engineering
- History matching
- Production optimization

---



## Recommended Learning Sequence

For seismic interpretation and reservoir evaluation:

1. F3 Netherlands 3D
2. Volve
3. Teapot Dome
4. NLOG

These are among the most complete and well-documented public datasets available for geoscience training, open-source software demonstrations, machine learning workflows, and subsurface studies.
