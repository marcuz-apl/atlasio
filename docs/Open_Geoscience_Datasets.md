# Free Public Well, Seismic, and Production Data for Open-Source Software Demos

> **Verified 2026-11-12 for Atlasio.** For the current well-header slice (EPSG:4326, one file up to 5 MiB), use **Sodir FactMaps WGS84 wellbores** (Norway) and **NSTA UKCS top holes WGS84** (United Kingdom). Curated **Volve** and **NSTA** subsets are now staged under `demo-data/volve/` and `demo-data/nsta/` for log, deviation, production, and seismic-index testing, but they are not ingestible by the header-only API yet. Raw NSTA offshore SEG-Y remains NDR-gated. F3, Teapot Dome, and NLOG remain deferred until LAS, SEG-Y, or CRS transformation is implemented. The recipes are in [operations/demo-data.md](operations/demo-data.md), `scripts/fetch-demo-wells.mjs`, `scripts/fetch-demo-volve.mjs`, and `scripts/fetch-demo-nsta.mjs`.



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

## 1b- NSTA UKCS Open Data (United Kingdom)

The North Sea Transition Authority publishes a broad UKCS open-data collection, but it is not one downloadable field package.

### Freely downloadable
- 13,367 open wellbore top holes in WGS 84, including the twelve NSTA wells already loaded in Atlasio.
- PPRS field-month production points in WGS 84: 136,201 rows covering 556 fields from June 1975 to August 2026.
- CGG Additional JDWLs: 188 MB archive with 28 LAS files and 48 deviation documents. The separate CGG digital log archive is 16 GB.
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
