# Well workflow implementation plan

> First thin slice of Release 1 in [PRD.md](../../../PRD.md). Implement in this repository and verify in a running local stack.

**Goal:** Stage a well header and original file, review QC and identity, publish an immutable version, then find the well by search and map.

**Architecture:** A Rust domain crate owns identity, QC, versioning, and coordinate rules. A Rust HTTP server owns the workflow and enforces authorization at its API and storage boundary. PostgreSQL/PostGIS stores explicit metadata, versions, audit events, and display points. S3-compatible storage holds original bytes. A bundled MapLibre client calls the same API used by records and search.

**Tech stack:** Rust, Axum, SQLx, PostgreSQL/PostGIS, S3-compatible object storage, MapLibre GL JS, Vite, Docker Compose. Pin concrete versions when the server crate is created.

## Workflow and acceptance

1. An importer uploads a synthetic well header manifest and an original file. The API records a checksum, source metadata, license, source coordinates, CRS, and QC findings.
2. The importer may correct staged metadata and submit only when blocking QC findings are resolved.
3. A reviewer resolves possible duplicate identity explicitly and approves or rejects the batch. Approval inserts a new immutable well version and records an audit event.
4. A reader searches by name, alias, or external ID, opens the record with its provenance and versions, and selects the same published well on the map.
5. The API enforces role and source-file access; only approved current versions appear in discovery.

## Data contracts and migration

- `import_batches`: staged manifest, file reference, QC, status, review outcome.
- `wells`: stable internal ID and current approved version pointer.
- `well_versions`: immutable published snapshot with source and display coordinates kept separately.
- `file_assets`: object key, checksum, source metadata and license linked to the batch.
- `audit_events`: stage, correction, submission, and decision events.
- `001_initial.sql` creates the first schema. No existing application data is migrated. The restore path must recover database and object storage together.

## Constraints

- Only explicitly supplied `EPSG:4326` coordinates can publish in this slice; other or missing CRSs produce blocking QC. This is a reversible first-slice limit, not a claim of general CRS support.
- Synthetic fixtures must be labeled and cover two countries. No customer files enter Git.
- Local demo API keys exercise API authorization; production identity integration remains outside this slice.
- The local stack uses S3Mock for test storage. Production storage and identity integration still need validation.

## Tasks

- [x] Create database migration, migration runner, and local PostgreSQL/PostGIS plus object storage stack.
- [x] Test and implement QC, duplicate candidates, and immutable publication rules.
- [x] Add staging, correction, review, record, search, map, and authorized file APIs.
- [x] Build the browser workflow with locally bundled map assets.
- [x] Run the whole workflow with both synthetic fixtures, verify migration and local restore, and document setup and limits.
