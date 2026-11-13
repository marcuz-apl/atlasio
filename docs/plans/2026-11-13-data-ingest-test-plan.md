# Data Ingest Test Plan — commission 2026-11-13 (morning)

Objective: exercise governed ingestion for **every data type** present in the four loaded demo packages (Sodir, NSTA, Volve, RMOTC), end to end, and report what passes, what is blocked, and what remains catalog-only. This plan is the commission for tomorrow morning; it is not yet executed.

## 1. What "ingest" means per type (Release 1 scope)

Per PRD §6 (W-03, S-02, S-03), Release-1 ingestion is **governed cataloging**, not full domain parsing:

- **Well header** — full pipeline: stage → QC (CRS/identity/coords) → correct → submit → review → immutable publish → search/map/record → original download. Already implemented.
- **Every other type** (logs, deviation, tops, production, core, images, documents, GIS/culture, seismic nav/2D/3D) — ingest **metadata + original file** into object storage with checksum, source CRS, licence, confidentiality, and access state; link to a well or seismic survey; make discoverable in the record and (for seismic) on the map. Domain parsing/viewers are later releases and are **out of scope** here.

So "test ingesting every type" = prove each type can be attached, preserved, governed, discovered, and downloaded with correct provenance — and that headers additionally parse/publish.

## 2. Baseline: what exists vs. the gap

Exists today (`crates/server/src/main.rs`): `/api/imports` (stage/correct/submit/review), `/api/wells/*`, `/api/map/wells`, `/api/files/{id}`. One original per batch (`file_assets.batch_id` UNIQUE), **5 MiB** base64 limit, header manifest only. CRS engine: `EPSG:4326` identity + ED50 `4230/23031/23032` via verified `EPSG:1311` (v0.1.40).

Gap (must be built first as Slice A, else non-header types cannot be ingested):
- No dataset/asset attach API or table (W-03). No seismic survey catalog or footprint map layer (S-02).
- No large-binary path: LAS/SEG-Y exceed 5 MiB and must stream to object storage, not base64 (S-03, AGENTS.md).
- USA (NAD27/83) and NL (RD New) CRS are **not registered**; those originals ingest with source CRS recorded but **no transform** (correct per invariants) until an operation is registered.

## 3. Prerequisites (verify before Phase 1)

- [ ] v0.1.40 committed/pushed/tagged/released at UTC rollover (counter reset); server rebuilt + restarted in WSL; migration 006 applied.
- [ ] `docker compose` DB + object storage up; `scripts/dev-server.sh` healthy at :8000.
- [ ] Datasets present under `demo-data/{sodir,nsta,volve,rmotc}` with `manifest.json` (already downloaded; OpendTect F3/Laurentian excluded — moved out).
- [ ] Demo keys resolve via `/api/demo-profiles`; importer/reviewer/reader roles available.
- [ ] Baseline green: `cargo test --workspace`, `node scripts/smoke.mjs`, `node scripts/verify-crs.mjs`.

## 4. Slice A — enable multi-type ingestion (build first, ~first third of morning)

Minimal, reversible extension; keep domain rules server-side.

- Migration `007_datasets.sql`: `datasets(id, well_id NULL, survey_id NULL, kind, format, source_crs, source_x, source_y, footprint geometry NULL, object_key, sha256, size_bytes, license, confidentiality, status, version_no, created_at)`; `seismic_surveys(id, name, kind('2d','3d'), source_crs, footprint geometry, license, confidentiality, status)`. Published rows immutable (reuse trigger pattern). No apostrophes / internal semicolons / leading `--` comments (splitter-safe).
- API: `POST /api/datasets` (metadata + original; small=base64, large=stream to object storage), `GET /api/wells/{id}/datasets`, `GET /api/datasets/{id}`, `GET /api/files/{id}` reuse for download; `POST /api/seismic-surveys`, `GET /api/seismic-surveys`, `GET /api/map/seismic` (footprints, transformed for display, source CRS preserved).
- QC reuse: registered-CRS check + area guard; checksum on upload; licence/confidentiality required; access enforced at API + storage.
- UI: record inspector "Datasets" list (kind/format/CRS/size/checksum/access + download); Ingest "attach dataset" to a published well; Explore seismic footprint layer + survey record.
- Acceptance: a LAS and a SEG-Y attach to a well/survey, stream to object storage, checksum matches, source CRS preserved, download returns identical bytes, reader sees only public items.

## 5. Data-type test matrix (run after Slice A)

For each row: attach via API, assert checksum + size + source CRS + licence + access; assert discovery (record list / map); assert download byte-identical; assert restricted items hidden from reader. Use one representative file per type per dataset where available.

| Type | Dataset / example | Format | Source CRS | Ingest mode | Key acceptance |
| --- | --- | --- | --- | --- | --- |
| Well header | Sodir/NSTA/Volve wellbores | GeoJSON/CSV | 4326 + ED50 4230/23031/23032 | full publish | source preserved; display transformed (1311); alias search; map |
| Well header (USA) | RMOTC `TeapotDomeWellHeaders…xlsx` | XLSX | NAD27/83 (unregistered) | catalog, no transform | source CRS recorded; blocked from publish until op registered |
| Logs | Volve/NSTA CGG/RMOTC LAS | LAS | n/a (MD curves) | attach to well | size/checksum; MD not treated as horizontal CRS |
| Deviation survey | Volve `NPD-*.csv`; NSTA docs; RMOTC xlsx | CSV/XLSX/TIF/PDF | 4230 / n/a | attach to well | trajectory CRS preserved; docs catalog-only |
| Formation tops | Sodir tables; RMOTC xls | CSV/XLS | n/a | attach to well | interval/MD semantics kept as metadata |
| Production | Sodir/NSTA PPRS/Volve/RMOTC | CSV/XLS | 4326 / n/a | attach (field-level) | labelled field-level, not per-well |
| Core / samples | Sodir cores/photos/cuttings/thin sections; RMOTC core | CSV/JPG | n/a | attach to well | image + metadata preserved |
| Documents / reports | Sodir well docs; NSTA deviation PDFs | PDF/DOCX | n/a | attach | licence/confidentiality enforced |
| GIS / culture | Sodir facilities/pipelines/blocks; RMOTC `.gdb` | Esri JSON/gdb | 23032/4230 / NAD | catalog + footprint | footprint transforms for display; source preserved |
| Seismic nav / 2D | Volve ST0299 lines; NSTA 2D index; RMOTC nav | SEG-Y/Esri JSON/txt | 23031/4230 / NAD | survey catalog | line footprint on map; original CRS visible |
| Seismic 3D | Volve st0202 time (+depth) cube; NSTA 3D index | SEG-Y/Esri JSON | 23031/4230 | survey catalog, object storage | large cube NOT copied to browser; footprint + checksum + size |

## 6. Morning schedule (time-boxed)

1. **0:00–0:20** Prerequisites + baseline green (§3). Release v0.1.40 if not already.
2. **0:20–1:20** Slice A (§4): migration + attach/catalog API + large-file path + minimal UI. Unit + API tests.
3. **1:20–2:20** Run matrix (§5) headers + well-attached types (logs/deviation/tops/production/core/docs) across datasets; write `scripts/verify-ingest-types.mjs`.
4. **2:20–3:00** Seismic + GIS rows (footprints, large-cube object storage, USA no-transform).
5. **3:00–3:30** Governance cross-checks (§7) + fix any defect + rerun affected rows.
6. **3:30–4:00** Report (§9), docs + CHANGELOG + version bump, commit/push/tag/release.

## 7. Cross-cutting governance checks

- Immutability: published dataset/survey/version cannot be updated/deleted; correction creates a new version.
- Provenance: every value links to source file + checksum + retrieval metadata; source CRS/coords never overwritten.
- CRS: no silent transform; unregistered CRS catalog-only; out-of-area ED50 blocked.
- Access: reader sees only public; restricted hidden in search/map/download; enforced at API + storage.
- Restore: backup + restore preserves datasets + objects together (run admin backup/verify).

## 8. Risks & mitigations

- **5 MiB limit / large cubes** → Slice A streaming object-storage path; never base64 a SEG-Y.
- **Unregistered USA/NL CRS** → catalog with source CRS, no transform; register operations later with control points.
- **One-file-per-batch legacy** → datasets table decouples assets from header batches; keep header pipeline unchanged.
- **Splitter-safe migrations** → no apostrophes/internal semicolons/leading comments (lesson from 006).
- **Licence/confidentiality** → keep source licence fields; RMOTC/NSTA terms recorded; no relabeling.
- **Scope creep (parsers/viewers)** → explicitly out of scope; catalog-only this commission.

## 9. Deliverables & go/no-go

- `scripts/verify-ingest-types.mjs` (per-type assertions) green; matrix results table (pass/blocked/catalog-only per type per dataset).
- Slice A migration + API + UI committed; docs (demo-data.md, user guide, build note) + CHANGELOG + VERSION bump; tag + GitHub Release.
- Report: what ingested fully, what is catalog-only, what is blocked (unregistered CRS), and the next-release parsing backlog.
- Go/no-go: all header rows publish; every non-header row attaches + preserves + governs + downloads; no silent transform; no access leak; restore verified.