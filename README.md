# Atlasio

**Governed subsurface data, in place.** Atlasio is a workspace for wells, seismic, and the evidence behind them: original files, provenance, immutable versions, role-scoped access, and coordinate integrity are the product, and a map-led surface makes the catalog discoverable.

Release 1 is in progress (current build `v0.1.39`; see [CHANGELOG.md](CHANGELOG.md)). The first vertical slice takes a well package through staging, QC, review, publication, search, and map display. Requirements and open decisions live in [PRD.md](PRD.md); implementation constraints and domain invariants live in [AGENTS.md](AGENTS.md).

## What it does

- **Governed ingestion.** Importers stage a header manifest plus the original file (SHA-256 recorded), resolve QC findings, correct metadata, and submit for review. Reviewers resolve well identity and publish immutable versions; corrections create new versions rather than rewriting history.
- **Map-first exploration.** Explore is a full-bleed map beneath the header with a floating toolbar, basemap gallery (public Esri tiles with an automatic offline vector fallback), live display controls, a catalog drawer, quick search, a coordinate rail, and PNG export. The mode bar (Explore / Records / Ingest / Review) sits in one stable place in every mode.
- **Records and provenance.** Every record keeps aliases and external IDs separate from its stable internal ID, and shows source position, source CRS, the recorded display transformation, reviewer, license, confidentiality, and the original file checksum.
- **Role-scoped access.** Viewer, importer, and reviewer keys plus staff accounts (Administrator, Data Manager) with forced first password change and optional TOTP MFA. Authorization is enforced at the API and storage boundary, not only in the UI.
- **Operations.** Access-profile management, backup creation and verification, typed-confirmation restore with a fresh pre-restore backup, and an administrative audit trail. The Admin Panel renders the change log as build history.

## Quick start

Requires Docker Compose, a Rust toolchain, and Node.js 20.19+ (or 22+). From the repository root:

```sh
docker compose up -d          # PostGIS + S3Mock (development only)
npm --prefix web ci
npm --prefix web run build
./scripts/dev-server.sh       # serves the API and web client on :3040
```

Open `http://localhost:3040`. After cloning, enable the commit hooks with `git config core.hooksPath .githooks`.

| Entry | Credentials | Notes |
| --- | --- | --- |
| Viewer | key `viewer-demo` | Search and inspect approved data |
| Importer | key `importer-demo` | Stage, correct, and submit packages |
| Reviewer | key `reviewer-demo` | Resolve identity and publish versions |
| Administrator | `admin` / `admin-initial` | Forced password change at first sign-in |
| Data Manager | `datamgr` / `datamgr-initial` | Forced password change at first sign-in |

Demo keys are managed records: rotate them in the Admin Panel and scripts resolve the current values from `GET /api/demo-profiles` instead of assuming the seeds. The dev server supplies development-only defaults for every setting; do not reuse them, the demo keys, or S3Mock for production data.

## Demo data

Synthetic fixtures from two countries ship with the repository and are loaded by the smoke tests; they are clearly labeled and contain no licensed customer data. Open-data downloaders stage real public material under `demo-data/` (gitignored):

- `node scripts/fetch-demo-wells.mjs --limit 12 --stage` — Sodir and NSTA well headers in WGS 84, staged through the governed import path.
- `node scripts/fetch-demo-sodir.mjs` — the openly published Sodir FactMaps/FactPages collection (layers and tables, ~1.9 GiB).
- `node scripts/fetch-demo-nsta.mjs` and `node scripts/fetch-demo-volve.mjs` — NSTA open well data and the Volve package.

Downloads preserve native CRS and format (including ED50) so import-time transformation can be tested; nothing is silently reprojected. Licences, coverage, and limits are documented in [docs/operations/demo-data.md](docs/operations/demo-data.md) and [docs/Open_Geoscience_Datasets.md](docs/Open_Geoscience_Datasets.md).

## Governance and coordinate integrity

- A published version is immutable; drafts and approved versions stay visibly distinct.
- Source coordinates and source CRS are preserved. Display positions store the exact transformation used; no datum, vertical, or time/depth conversion is inferred, and missing CRS never defaults to WGS 84.
- This slice publishes only explicitly supplied `EPSG:4326` positions; other CRSs block submission pending a verified operation. The upload limit is 5 MiB.
- Original files are preserved with checksums; download is offered only when published, license-permitted, and visible to the role.
- Well identity and wellbore identity stay separate; duplicate candidates require human resolution.

## Configuration

The dev script sets development defaults; production deployments must supply their own values.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL/PostGIS system of record |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION` | S3-compatible storage for original files |
| `ATLASIO_LOCAL_OBJECT_DIR` | Use a local directory for originals instead of S3 |
| `ATLASIO_ADMIN_USERNAME`, `ATLASIO_ADMIN_INITIAL_PASSWORD` | Seed the Administrator account (required) |
| `ATLASIO_DATAMGR_USERNAME`, `ATLASIO_DATAMGR_INITIAL_PASSWORD` | Seed the Data Manager account (required) |
| `ATLASIO_MFA_KEY` | Base64 32-byte key enabling authenticator enrolment |
| `ATLASIO_MFA_REQUIRED` | `1` requires MFA before privileged changes |
| `ATLASIO_BACKUP_DIR` | Backup archive directory |
| `ATLASIO_PG_DUMP`, `ATLASIO_PG_RESTORE` | Client-tool adapters (the dev script uses Docker adapters) |
| `ATLASIO_RESET_PASSWORDS` | One-shot recovery: reissues seeded passwords, clears MFA and sessions; remove after the recovery start |

## Recovery and operations

- **Lost authenticator, password known:** run the audited operator command `atlasio-server reset-mfa <username>` against the deployment database. It clears MFA, recovery codes, lockout, and sessions, keeps the password, writes an `auth.mfa.reset` audit entry, and does not restart the service.
- **Password lost as well:** start the service once with `ATLASIO_RESET_PASSWORDS=1`, then remove the flag; left in place it re-fires on every restart.
- **Backup and restore:** Administrators and Data Managers create and verify backups at `#/admin`; restore requires an Administrator, typed confirmation, and a fresh pre-restore backup, and pauses non-admin sessions while it runs.

Runbooks: [staff accounts and MFA recovery](docs/operations/staff-accounts.md), [backup and restore rehearsal](docs/operations/backup-restore.md). With S3 storage, pair the database archive with a provider snapshot.

## Tests

- `node scripts/smoke.mjs` — synthetic packages, version replacement, search, map API, download, and access checks.
- `node scripts/admin-smoke.mjs` — staff sign-in, profiles, demo-key rotation, backup, verification, restore rehearsal, maintenance blocking, and audit.
- `node scripts/auth-smoke.mjs` — MFA enrolment, code challenges, and recovery codes.
- `node scripts/verify-ingest-wizard.mjs` — table-import wizard end to end: messy CSV profile, auto-derived rules, DMS/decimal-comma/unit/date cleaning, blocked-row report, and staging.

## Repository layout

```
crates/server   Rust/Axum core: API, auth, governance, storage, backups
web             Vite + vanilla JS client with MapLibre GL (no UI framework)
migrations      PostgreSQL/PostGIS schema migrations
fixtures        Synthetic two-country fixtures, clearly labeled
scripts         Dev server, smoke tests, open-data downloaders, DB adapters
docs            Runbooks, decisions, versioning, dataset inventory
demo-data       Staged open data (gitignored)
backups         Local backup archives (gitignored)
```

## Project documents

- [Product requirements](PRD.md) — Release 1 scope, workflows, open decisions.
- [Agent instructions](AGENTS.md) — implementation constraints and domain invariants.
- [Versioning](docs/versioning.md) — `VERSION`, patch bumps, and commit hooks.
- [Implementation roadmap](docs/implementation-roadmap.md) — Release 1 sequencing.
- [Rust core decision](docs/decisions/0001-rust-core.md) — backend direction.
- [Open geoscience datasets](docs/Open_Geoscience_Datasets.md) — source inventory and access notes.

## Versioning and releases

The tracked `VERSION` file holds plain `m.n.p`. Every `feat`, `fix`, or `perf` commit increments the patch; documentation and maintenance commits leave it unchanged. Commit subjects are prefixed `v{VERSION}` and the UTC build identifier is stamped as an `Alfazen-Build` trailer by the hooks in `.githooks/`. Add the next version's [CHANGELOG.md](CHANGELOG.md) section in the same commit that bumps `VERSION`; the Admin Panel renders it as the product's build history.

## License

Apache License 2.0 — see [LICENSE](LICENSE).
