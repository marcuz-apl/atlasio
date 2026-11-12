# Atlasio — Product Requirements Document

**Status:** Founding product brief, ready for implementation planning  
**Date:** 2026-11-10  
**Working name:** Atlasio  
**Product definition:** Atlasio is a governed subsurface data workspace with a map-led way to discover and use the data.

## 1. Purpose

Oil and gas teams often have well, seismic, interpretation, drilling, and production data scattered across applications, file shares, physical archives, and personal projects. A map helps people find an asset, but the harder task is establishing what each dataset represents, whether it is trustworthy, which coordinate system it uses, and which version was used for a decision.

Atlasio will give data managers a controlled place to ingest, validate, reconcile, version, and publish subsurface data. Geoscientists and engineers will use search, records, and an excellent map to discover that data and understand its provenance. The product is intended for oil and gas organizations in any country. Pilot material from multiple countries will test the global data model and CRS engine. The platform should leave room for later non-oil-and-gas GIS domains.

## 2. Product position

| Reference product | Capability to learn from | Atlasio implication |
| --- | --- | --- |
| SLB Studio | Shared technical knowledge and collaboration around Petrel and Techlog | Manage reviewed technical datasets and interpretations, including versions and permissions. |
| Petrosys dbMap | Enterprise subsurface master data, quality, lineage, and audit | Make governance and data stewardship the product's core. |
| Landmark OpenWorks | Shared geological and geophysical project data | Keep working interpretations distinct from approved corporate data. |
| StackDX Maps / PetroNinja | Fast, approachable spatial discovery | Make the map a first-class entry point without making it the sole workflow. |
| Petrosys PRO | Advanced mapping and surface modeling | Support simple structure-map viewing initially; advanced modeling is a separate future capability or integration. |

Atlasio's initial differentiation is a modern, map-led interface over rigorous, vendor-neutral data management, with strong handling of legacy datasets and coordinate transformations across regions. This is a product hypothesis to test with users, not a claim of feature superiority over the products above.

## 3. Users and jobs

| User | Primary job |
| --- | --- |
| Data manager / geotechnician | Load packages, identify duplicates, fix metadata, review QC, approve authoritative records, trace changes. |
| Geoscientist / petrophysicist | Find wells and seismic quickly, inspect quality and provenance, compare versions, retrieve data for interpretation. |
| Geomatics specialist | Define source CRS and transformation, inspect coordinates, review exceptions, reproduce transformations. |
| Asset team lead | See data coverage and gaps for a field or area, understand which datasets are approved. |
| Administrator | Manage users, access, storage, reference vocabularies, and audit records. |
| Data Manager | Manage access profiles, demo keys, and verified backups; restore remains an Administrator action. |

## 4. Product principles

1. **Trust is visible.** Every managed dataset shows source, owner, status, version, timestamps, quality findings, and transformation history.
2. **Originals survive.** Preserve the source file and its checksum. Derivatives and normalized records point back to it.
3. **Coordinates are explicit.** Never infer a missing datum or silently treat an unknown CRS as WGS 84.
4. **Map and record agree.** A feature selected on the map opens the same authoritative record found by search.
5. **Large files stay practical.** Keep massive seismic volumes in managed object storage or an external governed location; index and preview them through Atlasio.
6. **Working data stays distinguishable.** Draft interpretations can coexist with approved corporate versions.
7. **Global core, local validation.** Country, company, basin, datum, and regulatory conventions are configurable; pilot data from multiple regions tests the core without defining it.

## 5. Core data concepts

- **Asset:** basin, concession/block, field, prospect, or other named area.
- **Well identity:** stable Atlasio ID plus all known external identifiers and name aliases. A well may have one or more wellbores.
- **Well location:** surface and relevant subsurface positions, each with source coordinates, source CRS, datum/elevation reference, uncertainty or quality, and calculated display coordinates.
- **Dataset:** logical item such as a log, deviation survey, tops set, report, image, seismic survey, navigation file, seismic volume, horizon, fault, grid, or geobody.
- **Dataset version:** immutable published snapshot with status, source, lineage, checksum, and review history. Draft revisions may change until submitted.
- **File asset:** original or derived binary with URI, size, type, checksum, retention/access policy, and relationship to a dataset version.
- **Interpretation:** a person's or team's technical result linked to source datasets and optionally promoted to an approved corporate version.
- **Import batch:** traceable delivery or load event with files, mapping choices, QC findings, and outcomes.

Identifiers and controlled vocabularies should align with established industry models where useful, especially PPDM, OSDU, and Energistics formats, without requiring a full implementation of those schemas in the first release.

## 6. Release 1: governed discovery and ingestion

The first release must demonstrate one complete workflow: import a real-world well package, resolve identity and coordinates, review quality findings, publish an approved version, then find and inspect it from search and map. It also catalogs a seismic survey and its files without requiring a large 3D cube to be copied onto a user's drive.

### 6.1 Well registry and content

**W-01** Create and maintain basin, field, block, well, and wellbore records with stable internal IDs, aliases, source identifiers, and relationships.  
**W-02** Store well header, operator, status, spud/completion dates when available, datum/elevation reference, location, and source provenance. Fields may be unknown; unknown must remain distinguishable from zero or an empty string.  
**W-03** Attach and catalog logs, deviation surveys, formation-top sets, reports, and images. Initially, the system must ingest metadata and original files; domain-specific parsing can expand incrementally.  
**W-04** Show versions and their differences for important well header fields and top picks. Preserve prior published versions and their source links.  
**W-05** Flag possible duplicate wells using identifiers, aliases, and spatial proximity for human review; never merge automatically.

### 6.2 Seismic catalog

**S-01** Register 2D/3D survey identity, acquisition/processing metadata when available, footprint or line geometry, source CRS, and associated fields/blocks.  
**S-02** Catalog navigation files, 2D lines, 3D cubes, and related documents with file location, size, checksum, format, owner, and access state.  
**S-03** Support object storage or governed external URIs for large cubes. Provide metadata and a lightweight footprint or preview; full-volume web rendering is outside Release 1.  
**S-04** Model interpreted horizons, faults, depth grids, and geobodies as versioned dataset types and support file attachment. Detailed interpretation editing is later work.

### 6.3 Coordinate reference systems and vertical references

**C-01** Record the source CRS of every spatial dataset, using an EPSG identifier where one is unambiguous and storing the full CRS definition when necessary. Preserve original coordinates.  
**C-02** Support verified transformations among the systems actually found in pilot data, including ED50, WGS 84, UTM zones, and Lambert variants. Support local datums where authoritative definitions and transformation parameters are available, and apply the same approach across countries. A name alone is insufficient to select an operation.\
**C-03** Show the selected transformation operation, parameters/grid dependency, accuracy information when supplied by the CRS library, and any warnings. Require explicit review when several plausible operations exist or a required grid is unavailable.  
**C-04** Keep horizontal CRS, vertical datum, well reference elevation, depth units, and time/depth domain as separate concepts. Do not silently convert KB/DF/GL, TVD/MD, or time/depth.  
**C-05** Validate transformations with known control points from the pilot datasets and round-trip checks. Store transformation provenance so the displayed map location can be reproduced.

### 6.4 Data stewardship

**G-01** Import a package into a staging area, inspect parsed metadata and source files, map fields, run validation, then submit it for review.  
**G-02** Produce actionable QC findings: missing CRS, out-of-range coordinates, unlikely units, missing identifiers, possible duplicates, conflicting values, and invalid geometries. Rules must distinguish error, warning, and informational findings.  
**G-03** Reviewers can approve, reject with reason, or return a staged import for correction. Published versions are immutable; corrections create new versions.  
**G-04** Maintain an audit trail for record changes, approvals, file replacement, and access-relevant actions.  
**G-05** Show an entity's source, import batch, related originals, derived files, status, reviewer, and publication history together.

### 6.5 Discovery and map

The signed-in landing page is a dashboard paired with a map scoped to an explicit area of interest. The dashboard groups coverage into Culture & Lands, Well Data, Seismic Data, Drilling & Completions, Production Data, and Documents & Reports. It summarizes concession maps, permits and licenses, land and lease records, GIS basemaps, wells, well versions, core and sample records, horizontal wells, logs, formation tops, well interpretations, seismic surveys, 2D lines, 3D cubes, seismic interpretations, drilling, DST, completion and workover records, production records, production tests, injection records, reports, M&A reports, and source files. Each count must come from cataloged records visible to the current user; unsupported or uncataloged categories must be shown as unavailable rather than as zero. Viewers can choose a country/area or request their current location through the browser. Workspace navigation opens the role-appropriate tools for managing or viewing records. The selected area and its source must be visible; location access requires browser permission.

**D-01** Search by well name/alias/identifier, field, block, survey name, dataset type, and free text in indexed metadata. Filter by status, geography, and source.  
**D-02** Show well points, fields/blocks, seismic lines/footprints, and simple approved structure grids on a responsive map. A selected item opens its record and available datasets.  
**D-03** Offer clear layer control, legend, scale, coordinate display, and CRS-aware readout. Signal approximate or unresolved locations visually.  
**D-04** Provide a record detail view that is useful without a map: metadata, versions, files, related records, QC, lineage, and actions allowed for the user's role.  
**D-05** Permit export/download only when the user's access rights and the source data's license allow it.  
**D-06** Provide a signed-in user guide at `#/docs` for viewers, importers, and reviewers covering roles, the dashboard, map inspection, search, ingest, review, and account security. Move the builder reference material — architecture, invariants, release history, decision records, references, and glossary — to `#/admin/docs`, limited to Administrators and Data Managers and linked from the Administration panel. The sign-in gate links to neither guide; the header Docs link appears after sign-in.

### 6.6 Security and deployment

**A-01** Authenticate users and apply role-based permissions to viewing, importing, reviewing, publishing, and administration. Allow dataset or project restrictions for confidential data.  
**A-02** Support an on-premises or private-cloud deployment path, including storage and services under the customer's control. Do not require public cloud access for core use.  
**A-03** Back up database metadata and object storage together with a documented restore procedure. The in-product backup and restore path is defined in §6.7.  
**A-04** Record license, confidentiality, and permitted use for every source package; pilot data must be owned, licensed, or explicitly authorized for use.

### 6.7 Administration and recovery

**ADM-01** Authenticate Administrator and Data Manager roles from username/password accounts seeded once from environment variables. Require the initial password to be changed at first sign-in and block privileged changes until it is; later environment changes do not alter an existing account unless `ATLASIO_RESET_PASSWORDS=1` explicitly reissues the password and clears MFA. Use Argon2id password hashes, opaque sessions with a twelve-hour lifetime, a five-attempt/five-minute lockout, and per-person audit identity. Managed viewer, importer, and reviewer profiles live in PostgreSQL; custom keys are stored as hashes, shown once at creation or rotation, and can be revoked immediately. Shared administrator and data-manager access keys are not honoured.  
**ADM-02** Provide an administration panel at `#/admin`, linked in the header only for Administrators and Data Managers. It shows application version, uptime, database size, connections, applied migrations, storage mode and originals, profile and account counts, MFA coverage, backup directory, access profiles, backups, and the administrative audit trail.  
**ADM-03** Treat demo keys as managed records. Rotating or revoking a demo key must update the public sign-in gate without a client rebuild, and a revoked demo key must leave the gate.  
**ADM-04** Define a backup as a PostgreSQL custom-format dump plus a manifest containing the archive checksum, record counts, application version, and object-set summary. With local object storage, copy original files into the archive; with S3, require a provider snapshot or bucket copy alongside the dump. Data Managers may create, download, and verify backups; verification restores into a scratch database and compares counts.  
**ADM-05** Restrict database restore to Administrators. Require typed confirmation of the backup identifier, take a fresh pre-restore backup, verify the archive checksum, pause non-admin sessions for the duration, and record the restore in the audit trail. A failed restore must leave maintenance mode on so the pre-restore backup remains the recovery path.  
**ADM-06** Record profile creation, rotation, activation changes, backup creation and deletion, and restores as administrative audit events, and show the most recent events in the panel. Deleting a backup is an Administrator action.  
**ADM-07** Show the product's build history as a change log in the administration panel, read from a repository file at request time so a deployment can update it without rebuilding the server. Each entry carries version, release date, build identifier, change type, commit reference when known, and the user-visible changes; the newest release is marked and the file is updated in the same commit that bumps `VERSION`.  
**ADM-08** Support optional TOTP MFA for each staff account, with one-time recovery codes. Encrypt authenticator secrets at rest with a deployment key (`ATLASIO_MFA_KEY`); when `ATLASIO_MFA_REQUIRED=1`, block privileged changes until the account enrols. Require the current password to start enrolment or disable MFA, consume recovery codes once, and revoke the account's other sessions when MFA is disabled. A password reset clears MFA. When an operator has lost both the authenticator and the recovery codes, the operator-only `reset-mfa <username>` command clears that account's enrolled MFA, lockout, and sessions while keeping the password, and records an `auth.mfa.reset` audit entry. No environment flag and no service restart are involved.

## 7. Subsequent releases

These are in scope for the platform vision, but are not a condition for the first usable release.

1. **Deeper well data:** parsed LAS/DLIS curves, richer survey validation, top correlation, cores, interval data, interpretation comparisons, and well-log viewers.
2. **Seismic and interpretation:** thumbnails/slices and streamed access to large volumes; horizon, fault, grid, and geobody visualization; links to specialized interpretation tools.
3. **Drilling and completion:** well plans, daily operations, casing, cementing, stimulation, completion strings, events, and document packages.
4. **Production:** well and field volumes, allocations, time-series QC, units, and lineage to source systems.
5. **Interoperability:** practical import/export and connectors for common industry formats and systems, prioritized by pilot users; OSDU-facing APIs where justified.
6. **Advanced maps:** cross-sections, structure map styling, contouring, comparison, and publication workflows. Atlasio need not reproduce a full interpretation or mapping suite.

## 8. Pilot workflows and acceptance

### Workflow A — reconcile a pilot well

A data manager imports a well header, deviation survey, LAS or scanned log, tops spreadsheet, and report. Atlasio retains the originals, detects a likely existing well under an alternate name, reports CRS and unit ambiguities, and presents the source and proposed normalized values. The manager resolves the identity and location, a reviewer approves the package, and a new immutable published version appears in the well record and on the map. The previous version remains inspectable.

**Release 1 acceptance:** This workflow can be completed end to end with a licensed pilot package. No coordinate transform or duplicate merge occurs silently. A second user can find the approved well by alias, field, and map location and trace each published value to its source.

### Workflow B — find a seismic survey

A geoscientist searches an area, sees 2D lines and 3D footprints, opens a survey, reviews its CRS, acquisition/processing metadata, available files, size, access rights, and related wells, then retrieves an authorized file or storage reference.

**Release 1 acceptance:** The survey is discoverable without loading a full 3D cube into the browser or copying it to a local drive. Its footprint transforms correctly for display and the original CRS is visible.

### Workflow C — audit a decision

An asset lead opens a well or survey used in an interpretation and can identify the approved dataset version, source files, publication date, reviewer, and relevant QC or coordinate warnings.

**Release 1 acceptance:** Published data remains reproducible after a later correction or import.

## 9. Initial technical direction

This is the starting architecture to validate through the first working slice. The Rust core and backend decision is recorded in [Decision 0001](docs/decisions/0001-rust-core.md):

- **System of record:** PostgreSQL with PostGIS for relational metadata, geometries, constraints, and spatial queries. Prefer it over MySQL for this geospatial workload. Do not make Microsoft SQL Server a Release 1 dependency; assess a connector if a pilot customer needs one.
- **Large binaries:** S3-compatible object storage or a governed external repository, referenced by versioned metadata and checksums. Do not store seismic cubes as ordinary database rows.
- **CRS engine:** a mature PROJ-based service/library with pinned coordinate-operation definitions and required transformation grids. Record the operation selected for each derived location.
- **Map:** a modern web map client such as MapLibre, with server-side spatial queries and appropriate raster/vector delivery for previews and grids.
- **API and UI:** use Rust for domain rules and the backend API, with a web client for the initial interface. Prove the stack through import, review, publication, search, and map display. Keep domain rules and coordinate logic server-side.

The architecture must support export of original and normalized data, documented APIs, and migration away from any chosen storage provider.

## 10. Measures of success

- Pilot users can complete Workflow A without spreadsheet or database intervention after initial configuration.
- Every published pilot well and seismic survey has visible source, CRS, status, and version information.
- Known pilot control points pass agreed transformation tolerances set by a geomatics reviewer; no generic tolerance is assumed for all CRSs.
- Users can locate a known well or survey by name, alias, field, or map and determine whether it is approved.
- A restore exercise can recover a published record and its original files consistently.
- A second, synthetic or licensed fixture from another country passes the same import, CRS, search, and publication workflow without country-specific code changes.

## 11. Open decisions for implementation planning

These decisions require pilot data or user validation before committing to detailed interfaces and infrastructure:

1. Which licensed datasets and reference control points are available for the first pilot, and which additional-country fixture will test portability?
2. Which file formats occur most often in those packages, and which require parsing in Release 1 versus cataloging only?
3. What deployment environment, identity provider, and data-residency requirements will the first operator impose?
4. Which exact CRS definitions, transformation grids, and vertical references occur in the pilot material?
5. Which export or integration target is the first pilot's highest priority?

## 12. Market references

- [SLB Studio](https://www.slb.com/products-and-services/delivering-digital-at-scale/software/studio-e-and-p-knowledge-software/studio)
- [Petrosys dbMap](https://www.petrosysgroup.com/product/dbmap/) and [Petrosys PRO](https://www.petrosysgroup.com/product/pro/)
- [Halliburton OpenWorks](https://www.halliburton.com/en/software/decisionspace-365-enterprise/ds365-ai/openworks-software)
- [StackDX Maps](https://www.stackdx.com/solutions/mapping-field-data/)

These links describe reference products; the requirements and release boundaries above are Atlasio product decisions.
