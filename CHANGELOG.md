# Atlasio change log

Every released build, newest first. The Admin Panel at `#/admin` renders this file as the product's build history.

Maintenance rule: add the next version's section in the same `feat`, `fix`, or `perf` commit that bumps `VERSION`. Run `.githooks/alfazen-version id` to obtain the build identifier the commit hook will stamp. Keep bullets factual and user-visible; internal refactors that change no behaviour can be omitted.

## 0.1.19 — 2026-11-12
Build: v0.1.19+2611125
Type: feat
- Add a change log to the Admin Panel, read from this repository file so the build history ships with the product and updates without a rebuild.
- Show version, release date, build stamp, change type, commit, and highlights, with the newest release marked.

## 0.1.18 — 2026-11-12
Build: v0.1.18+2611124
Type: fix
Commit: 05bf92c
- Honour the configured database in the Docker backup adapters, so backup verification and restore compare the same dataset instead of the default database.

## 0.1.17 — 2026-11-12
Build: v0.1.17+2611123
Type: feat
Commit: 2f717f4
- Add the administration panel for Administrators and Data Managers: system status, access profiles, backups, and an administrative audit trail.
- Manage viewer, importer, and reviewer profiles in PostgreSQL; custom keys are hashed and shown once, while demo keys can be rotated and revoked with the sign-in gate following immediately.
- Add backups as a PostgreSQL dump plus a manifest with checksum and record counts, scratch-database verification, download, deletion, and an Administrator-only restore with typed confirmation, a pre-restore backup, and maintenance mode.

## 0.1.16 — 2026-11-12
Build: v0.1.16+2611122
Type: feat
Commit: 16f538d
- Add the public `#/docs` reference page covering architecture, invariants, the catalog, interface decisions, release history, decision records, references, and glossary.
- Link the page from the header and the access gate; it stays readable without a workspace key.

## 0.1.15 — 2026-11-12
Build: v0.1.15+2611121
Type: feat
Commit: fdeab6d
- Regroup the catalog into Culture & Lands, Well Data, Seismic Data, Drilling & Completions, Production Data, and Documents & Reports.
- Use Title Case labels across twenty-four categories and a dense three-column coverage ledger at wide widths.

## 0.1.14 — 2026-11-11
Build: v0.1.14+261111e
Type: feat
Commit: 973809f
- Enlarge the product name and header descriptor while keeping the mobile header intact.

## 0.1.13 — 2026-11-11
Build: v0.1.13+261111d
Type: feat
Commit: 4c08f2b
- Stack the base contour under the logo's inner line and let it replace the original triangle base.

## 0.1.12 — 2026-11-11
Build: v0.1.12+261111c
Type: feat
Commit: bb8cdc0
- Open the logo triangle by removing its base and replace it with a contour line; apply the same geometry to the favicon.

## 0.1.11 — 2026-11-11
Build: v0.1.11+261111b
Type: feat
Commit: 4db152d
- Turn the automatic theme dark after nightfall using a local 19:00–07:00 rule, applied before first paint and re-checked every thirty seconds.

## 0.1.10 — 2026-11-11
Build: v0.1.10+261111a
Type: feat
Commit: df92c88
- Replace the logo mark with the contour geometry and add the site favicon.

## 0.1.9 — 2026-11-11
Build: v0.1.9+2611119
Type: feat
Commit: 133f308
- Adopt the Alfazen platform color scheme across light, dark, and automatic themes.

## 0.1.8 — 2026-11-11
Build: v0.1.8+2611118
Type: fix
Commit: 80166bf
- Remove the duplicate role readout from the footer.

## 0.1.7 — 2026-11-11
Build: v0.1.7+2611117
Type: fix
Commit: 17ddf66
- List Disclaimer before About in the footer.

## 0.1.6 — 2026-11-11
Build: v0.1.6+2611116
Type: fix
Commit: 412ecbe
- Replace competing theme controls with one slot that cycles automatic, light, and dark.

## 0.1.5 — 2026-11-11
Build: v0.1.5+2611115
Type: feat
Commit: e3cd696
- Move About and Disclaimer into a centered Alfazen footer.

## 0.1.4 — 2026-11-11
Build: v0.1.4+2611114
Type: feat
Commit: 6a2b48e
- Rebuild the web interface as a survey instrument with a map-led landing page and workspace.

## 0.1.3 — 2026-11-11
Build: v0.1.3+2611113
Type: feat
Commit: 4bc6cac
- Add the area dashboard and workspace footer.

## 0.1.2 — 2026-11-11
Build: v0.1.2+2611112
Type: fix
Commit: 0463f3d
- Polish the map-led explorer interface.

## 0.1.1 — 2026-11-11
Build: v0.1.1+2611111
Type: feat
Commit: 6fb8da8
- Build the governed well workflow: staging, QC, review, publication, alias search, map display, and original-file download.

## 0.1.0 — 2026-11-10
Build: v0.1.0+2611101 → v0.1.0+2611103
Type: chore
Commit: d774d4d
- Initialize Atlasio with the prefixed Alfazen versioning policy.
- Add the project README and the Apache 2.0 license.
- Choose the Rust core and record the first-slice plan.
