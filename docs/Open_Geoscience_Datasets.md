# Free Public Well, Seismic, and Production Data for Open-Source Software Demos

> **Verified 2026-11-12 for Atlasio.** For the current well-header slice (EPSG:4326, one file up to 5 MiB), use **Sodir FactMaps WGS84 wellbores** (Norway) and **NSTA UKCS top holes WGS84** (United Kingdom). A curated **Volve** subset is now staged under `demo-data/volve/` for raw log, deviation, production, 2D, and 3D file testing, but it is not ingestible by the header-only API yet. F3, Teapot Dome, and NLOG remain deferred until LAS, SEG-Y, or CRS transformation is implemented. The recipes are in [operations/demo-data.md](operations/demo-data.md), `scripts/fetch-demo-wells.mjs`, and `scripts/fetch-demo-volve.mjs`.



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
