# Atlasio change log

Every released build, newest first. The Admin Panel at `#/admin` renders this file as the product's build history.

Maintenance rule: add the next version's section in the same `feat`, `fix`, or `perf` commit that bumps `VERSION`. Run `.githooks/alfazen-version id` to obtain the build identifier the commit hook will stamp. Keep bullets factual and user-visible; internal refactors that change no behaviour can be omitted.

## 0.8.0 — 2026-11-17
Build: v0.8.0+2611174
Type: fix
- Fixed the licences-and-blocks overlay never rendering: its GeoJSON source was named `land` and a layer `land-line`, which already exist in the basemap style, so the loader found the basemap source and returned before adding anything. The overlay now uses `land-areas`, `landarea-fill`, and `landarea-line`.
- The Dashboard "Concession Maps" count now reports distinct licence references (370) instead of licence-block polygons (723); a licence that covers several blocks remains one concession, while every block polygon stays on the map.
- Overlay loaders also attach on the first rendered frame, so layers appear even when the style `load` event has already fired.
- Removed two synthetic restricted test records left behind by an interrupted verification run.

## 0.7.9 — 2026-11-17
Build: v0.7.9+2611173
Type: feat
- New governed record type **Land areas**: concession, licence, block, lease, and interest polygons with code, block reference, operator, parties, licence status, effective dates, source, and licence metadata (migration 011). Source geometry is preserved in its native CRS — the NSTA licensed blocks stay in ED50 geographic (EPSG:4230) — and the WGS 84 display footprint is derived only through the verified CRS engine. Published records are immutable.
- New API: `POST /api/land-areas` (importer and staff) is idempotent per kind/code/block identity, `GET /api/land-areas` lists with confidentiality scoping, `GET /api/land-areas/{id}` returns a record, and `GET /api/map/land-areas` serves published public display geometry for the map.
- Explore gains a **Licences & blocks** layer with a Display toggle and click-to-inspect details (operator, status, effective dates, source CRS, licence). The Dashboard "Concession Maps" count now reports loaded concessions instead of "planned".
- New `scripts/import-land-areas.mjs` imports NSTA open data: 698 UKCS offshore petroleum licensed blocks (ED50, rich licence attributes), the 7,266-block UKCS reference grid, and 25 current carbon storage licences. Each layer's own metadata declares its source CRS, which is stored unchanged.
- New `scripts/verify-land-areas.mjs` verifies the slice end to end: ED50 preservation and WGS 84 derivation, map features for readers, restricted-record isolation, idempotent duplicates, input validation, and trigger-enforced immutability.

## 0.7.8 — 2026-11-17
Build: v0.7.8+2611172
Type: feat
- `scripts/smoke.mjs` now cleans up after itself: every synthetic well it publishes during a run (second-country, revision, and restricted fixtures) is removed when the run ends, so verification runs no longer leave test wells in the workspace. Cleanup runs in a `finally` block, so it also removes the wells when an assertion fails.
- `scripts/cleanup-synthetic-wells.sh` gains an exact-ID mode (`--well-ids id1,id2,...`) that removes precisely the listed wells instead of every synthetic-named well; the default name-based mode is unchanged. Set `ATLASIO_SMOKE_KEEP=1` to keep a smoke run's wells for inspection; remote `ATLASIO_URL` targets are left untouched.

## 0.7.7 — 2026-11-17
Build: v0.7.7+2611171
Type: feat
- The logo mark's red dot is now an oil drop: the round accent dot inside the "A" mark is replaced by a teardrop with a pointed top and round bulb, filled in the same accent red. Applied to the app header, the sign-in gate, and the browser favicon (`web/public/favicon.svg`).

## 0.7.6 — 2026-11-15
Build: v0.7.6+2611156
Type: feat
- New operator script `scripts/cleanup-synthetic-wells.sh` removes the synthetic test wells that the smoke and verification suites publish into the workspace (the Canada/Australia fixtures and the CRS, dataset-host, and industry-header test wells), together with their versions, batches, file records, attached datasets, stored originals, and audit-batch links. Real demo data (NSTA, RMOTC, Sodir, Volve) is never matched: only wells whose current name starts with `SYNTHETIC` are removed. The script drops the immutability triggers for one transaction, recreates them exactly afterwards, verifies they are active again, and preserves audit history by clearing batch links instead of deleting entries.

## 0.7.5 — 2026-11-15
Build: v0.7.5+2611155
Type: feat
- New operator script `scripts/reset-passwords.sh` recovers a locked-out staff account: it runs the supported one-shot `ATLASIO_RESET_PASSWORDS=1` boot, verifies that both the Administrator and Data Manager accounts accept their seeded initial passwords again, clears MFA and login lockouts, then restarts the server normally so the flag never re-fires. Each reset writes an `auth.password.reset` entry to the audit trail, and both accounts must set a new password at first sign-in.

## 0.7.3 — 2026-11-15
Build: v0.7.3+2611153
Type: feat
- Admin Panel gains a **Map basemaps** panel: Administrators and Data Managers set the deployment default basemap — the Esri styles, OpenStreetMap, or the offline vector map — and the choice is stored in a governed `app_settings` table (migration 010) with an `admin.settings.update` audit entry.
- The workspace applies the deployment default only when a user has not picked their own basemap; an explicit personal choice always wins, and unsetting the default restores the per-theme default (Topographic in light mode, Dark gray canvas in dark mode).
- `GET /api/map-settings` is readable by every signed-in role; `PUT /api/admin/map-settings` is staff-only, validates the basemap key, and is blocked during maintenance. Verified by an extended `scripts/admin-smoke.mjs`.

## 0.7.2 — 2026-11-15
Build: v0.7.2+2611152
Type: feat
- Basemap gallery gains OpenStreetMap (© OpenStreetMap contributors) as a second public tile source beside the Esri basemaps, reducing single-provider risk; the offline vector map remains the no-network fallback. The basemap note now shows the active provider's own credit instead of assuming Esri.
- The in-app user guide's basemap and credits sections, and the README, reflect the added provider.

## 0.7.0 — 2026-11-14
Build: v0.7.0+2611146
Type: fix
- Ingest layout: the "Attach dataset to a published well or survey" card now insets its labels, inputs, dropzone, and button from the panel edges (22 px desktop, 16 px on small screens), matching the staging and table-import cards. The attach form also gains the same vertical rhythm as the other ingest forms.

## 0.6.9 — 2026-11-14
Build: v0.6.9+2611145
Type: feat
- Table-import wizard: import a CSV or XLSX of well headers through the new "Import from a header table" panel in Ingest. The server profiles every column (kind, fill rate, flags for DMS coordinates, decimal commas, embedded units, null-heavy columns), suggests a mapping to the governed fields, and stages rows through the same review flow as single packages.
- Pre-conditioning rules are derived automatically from the detected profile and saved with the table: DMS coordinates become decimal degrees, decimal commas normalize, embedded units strip, null tokens such as -999.25 collapse to empty, and mixed date formats normalize to ISO. Every change is audited with a before/after trail; the original file is stored unchanged.
- Rows the engine cannot place safely (missing CRS, no usable position) are blocked, never guessed; importers download a CSV error report, fix the rows in the source, and re-upload. Duplicate UWIs in one table are surfaced as findings for reviewer resolution.
- Migration 009 drops the one-file-per-package unique constraints and adds `ingest_tables` / `ingest_table_rows`. Verified end to end by `scripts/verify-ingest-wizard.mjs`.

## 0.6.7 — 2026-11-14
Build: v0.6.7+2611143
Type: feat
- Datasets: attach any original (logs, deviation, tops, production, core, documents, seismic) to a published well or seismic survey with kind, format, source CRS, licence, and confidentiality; checksum and size are recorded and downloads are byte-identical. Originals above 5 MiB stream to object storage in multipart parts; published datasets are immutable.
- Seismic survey catalog (2D/3D) preserves source-CRS footprints; display footprints are transformed to WGS 84 only for registered CRS, and unregistered CRS stays catalog-only with no display geometry.
- Explore gains a seismic footprint layer with a display toggle; the record inspector lists attached datasets with authenticated download; Ingest gains an attach-dataset form.
- Migration 007 adds `datasets` and `seismic_surveys` with immutability triggers.

## 0.6.6 — 2026-11-14
Build: v0.6.6+2611142
Type: feat
- Well headers carry the industry columns: folder, well symbol, drilling structure, operator, well datum name/value/unit (KB/GL/RF), TD (MD) with unit, bottom-hole X/Y, source latitude/longitude with their own geographic CRS, and spud/completion dates. All are preserved as provided and shown in the record inspector; the external ID field is labelled UWI.
- Import accepts three position modes: projected X/Y with a CRS, geographic lat/lon with a CRS, or both (a mismatch beyond 0.001 degrees warns). CRS aliases such as `ED50 / UTM zone 32N` normalize to their code; X/Y are no longer mandatory.
- New QC warnings that never block: missing datum or TD unit, datum name outside KB/GL/RF/DF, lat/lon without a geographic CRS, position mismatch, and non-ISO dates.
- Migration 008 adds the header columns and makes source X/Y nullable for geographic-only headers; published versions remain immutable.

## 0.6.5 — 2026-11-14
Build: v0.6.5+2611141
Type: feat
- The app serves on port 3040: the server binds `0.0.0.0:3040`, and the smoke, auth, admin, demo-well, and CRS verification scripts plus the README default to `http://localhost:3040`.
- `ATLASIO_URL` still overrides the script target, and the web client is unchanged because it calls same-origin `/api` paths.

## 0.6.4 — 2026-11-13
Build: v0.6.4+2611133
Type: fix
- Both documentation guides (the user guide at `#/docs` and the build notes at `#/admin/docs`) span 85% of the screen width on desktop and the full content width on narrow screens, instead of a narrow centered column.
- The site footer (Disclaimer, About, copyright) is visible on both guides; leaving Explore no longer keeps it hidden on documentation pages.
- Reading type is larger and calmer in both themes: 15px prose with 1.7 line height, 26px section headings, and proportionally larger tables, notes, decision cards, and references.

## 0.6.2 — 2026-11-13
Build: v0.6.2+2611131
Type: feat
- Import-time CRS transformation: native ED50 source positions (EPSG:4230 geographic, EPSG:23031/23032 UTM 31N/32N) are reprojected to WGS 84 for display using the verified EPSG:1311 operation (±1 m); source CRS and coordinates are preserved and the operation and accuracy are recorded on each published version.
- The importer offers the supported source CRS with CRS-aware axis labels and validation; the record inspector shows the applied operation and display accuracy.
- Positions outside the verified area of EPSG:1311 and unregistered CRS are blocked at QC instead of being silently transformed.

## 0.6.0 — 2026-11-12
Build: v0.6.0+261112y
Type: fix
- In Records, Review, and Ingest the mode control aligns with the cards' left edge on the content grid, while Explore keeps its floating map-edge inset; the vertical gap below the header is unchanged in every mode.

## 0.5.9 — 2026-11-12
Build: v0.5.9+261112x
Type: fix
- The Workspace mode control (Explore / Records / Ingest / Review) now sits at the same top-left position with the same 16px padding below the header in every mode, instead of jumping to the top-right outside Explore.
- Remove the Workspace hero title and lede; the mode bar is the workspace's only head, with the map chrome re-spaced beneath it.

## 0.5.8 — 2026-11-12
Build: v0.5.8+261112w
Type: fix
- Records now refreshes with the active query every time it is opened, so returning from the inspector bridge or another tab never shows stale rows or a broken table.
- A denied full-screen request shows a calm notice instead of an unhandled promise error.

## 0.5.7 — 2026-11-12
Build: v0.5.7+261112v
Type: feat
- Explore becomes a full-bleed map beneath the header: floating toolbar, basemap gallery with an offline vector fallback, live display controls, catalog drawer, quick search, coordinate rail, and PNG export.
- The record inspector gains Open in Records and Copy well ID, bridging map discovery to stewardship.
- Ingest gains Pick on map: an explicit pick fills X/Y and sets the source CRS to EPSG:4326; native-CRS entry by typing is unchanged.
- Version hooks fall back to a working Python interpreter where `python3` is a non-functional stub.

## 0.5.6 — 2026-11-12
Build: v0.5.6+261112u
Type: feat
- Remove the area-of-interest helper line so the control is compact and the catalog and map start higher.

## 0.5.3 — 2026-11-12
Build: v0.5.3+261112r
Type: feat
- Tighten the dashboard hero: reduce the title, keep the summary on one line, and start the catalog and map higher.

## 0.5.2 — 2026-11-12
Build: v0.5.2+261112q
Type: feat
- Let the shared page shell fill the viewport, so the header, workspace, and footer use the full screen width minus the responsive gutter.

## 0.4.6 — 2026-11-12
Build: v0.4.6+261112k
Type: feat
- Replace the Horizontal Wells tile with Deviation Surveys under Well Data. Well orientation becomes an attribute derived from the survey rather than a separate category.
- Document the change in both guides without changing the twenty-five-category count.

## 0.4.4 — 2026-11-12
Build: v0.4.4+261112i
Type: feat
- Rename the viewer demo key to `viewer-demo`, with a migration that updates the seeded profile.
- Shorten the seeded staff passwords to `admin-initial` and `datamgr-initial`.
- Record the catalog taxonomy decision and add glossary entries for well versions, source files, DST, and core samples.

## 0.4.3 — 2026-11-12
Build: v0.4.3+261112h
Type: feat
- Remove the E&P Projects tile from Well Data and rename Original Files to Source Files.
- Add DST Records under Drilling & Completions and Core & Sample Records under Well Data as planned categories.
- Explain in the guides that Wells counts current wells while Well Versions counts every published version, including corrections.

## 0.4.2 — 2026-11-12
Build: v0.4.2+261112g
Type: feat
- Put GIS & Basemaps first under Culture & Lands, and Production Tests first under Production Data.

## 0.4.1 — 2026-11-12
Build: v0.4.1+261112f
Type: feat
- Add the operator-only command `atlasio-server reset-mfa <username>` for a lost authenticator and recovery codes. It clears that account's MFA, lockout, and sessions, keeps the password, writes an `auth.mfa.reset` audit entry, and exits without restarting the service.
- No reset state lives in the environment, so a normal restart can never strip MFA.

## 0.4.0 — 2026-11-12
Build: v0.4.0+261112e
Type: fix
- Stop Chrome from restoring the previous staff username or password on the sign-in gate. The fields stay read-only until you click or tab into them, so autofill has nothing to fill.

## 0.3.9 — 2026-11-12
Build: v0.3.9+261112d
Type: feat
- Show the header tagline "Governed subsurface data, in place" beside the logo on the sign-in gate.
- Clear the staff username, password, and authenticator fields whenever the sign-in gate reappears, and turn off browser autocomplete for them.

## 0.3.8 — 2026-11-12
Build: v0.3.8+261112c
Type: feat
- Give multi-factor authentication its own account-menu entry beside Change password, instead of hiding it inside the password dialog.
- Label the entry Set up MFA until an authenticator is enrolled, then Manage MFA.

## 0.3.7 — 2026-11-12
Build: v0.3.7+261112b
Type: feat
- Split the reference page by audience. Signed-in viewers, importers, and reviewers now get a user guide at `#/docs` covering roles, dashboard, map inspection, search, ingest, review, and account security.
- Move the build notes and decision records to `#/admin/docs`, linked from the Administration panel and limited to Administrators and Data Managers.
- Show the header Docs link after sign-in only, remove the build-notes link from the sign-in gate, and add a back link from the build notes to Administration.

## 0.3.6 — 2026-11-12
Build: v0.3.6+261112a
Type: fix
- Lower the new-password minimum from 12 to 8 characters, in both the server rule and the password dialog.

## 0.3.5 — 2026-11-12
Build: v0.3.5+2611129
Type: feat
- Replace the staff access chip's dialog with an account menu: User profile, Change password, and Log out.
- Show account details in User profile, and manage the authenticator app from Change password.
- Collapse the Admin Panel change log and audit trail by default, with Show/Hide controls that keep their entry counts visible.

## 0.3.4 — 2026-11-12
Build: v0.3.4+2611128
Type: feat
- Replace shared Administrator and Data Manager access keys with username/password accounts seeded once from the environment, hashed with Argon2id.
- Require the initial password to be changed at first sign-in; a persistent banner blocks privileged changes until it is, and the audit trail records the person who acted.
- Add opaque twelve-hour sessions with sign-out, a five-attempt lockout, and a gate sign-in form; viewer, importer, and reviewer keys keep working as before.
- Add optional TOTP MFA with a QR enrolment, one-time recovery codes, and password-confirmed disable; `ATLASIO_MFA_REQUIRED=1` blocks privileged changes until an account enrols.
- Encrypt authenticator secrets with `ATLASIO_MFA_KEY`, show account and MFA counts in the Admin Panel, and clear MFA on an explicit password reset.

## 0.3.3 — 2026-11-12
Build: v0.3.3+2611127
Type: fix
- Replace the header descriptor with the approved promise: Governed subsurface data, in place.
- Use the same line in the About dialog and drop its terminal period, matching the display rule.

## 0.3.1 — 2026-11-12
Build: v0.3.1+2611125
Type: feat
Commit: 1c288db
- Add a change log to the Admin Panel, read from this repository file so the build history ships with the product and updates without a rebuild.
- Show version, release date, build stamp, change type, commit, and highlights, with the newest release marked.

## 0.3.0 — 2026-11-12
Build: v0.3.0+2611124
Type: fix
Commit: 05bf92c
- Honour the configured database in the Docker backup adapters, so backup verification and restore compare the same dataset instead of the default database.

## 0.2.9 — 2026-11-12
Build: v0.2.9+2611123
Type: feat
Commit: 2f717f4
- Add the administration panel for Administrators and Data Managers: system status, access profiles, backups, and an administrative audit trail.
- Manage viewer, importer, and reviewer profiles in PostgreSQL; custom keys are hashed and shown once, while demo keys can be rotated and revoked with the sign-in gate following immediately.
- Add backups as a PostgreSQL dump plus a manifest with checksum and record counts, scratch-database verification, download, deletion, and an Administrator-only restore with typed confirmation, a pre-restore backup, and maintenance mode.

## 0.2.8 — 2026-11-12
Build: v0.2.8+2611122
Type: feat
Commit: 16f538d
- Add the public `#/docs` reference page covering architecture, invariants, the catalog, interface decisions, release history, decision records, references, and glossary.
- Link the page from the header and the access gate; it stays readable without a workspace key.

## 0.2.7 — 2026-11-12
Build: v0.2.7+2611121
Type: feat
Commit: fdeab6d
- Regroup the catalog into Culture & Lands, Well Data, Seismic Data, Drilling & Completions, Production Data, and Documents & Reports.
- Use Title Case labels across twenty-four categories and a dense three-column coverage ledger at wide widths.

## 0.2.6 — 2026-11-11
Build: v0.2.6+261111e
Type: feat
Commit: 973809f
- Enlarge the product name and header descriptor while keeping the mobile header intact.

## 0.2.5 — 2026-11-11
Build: v0.2.5+261111d
Type: feat
Commit: 4c08f2b
- Stack the base contour under the logo's inner line and let it replace the original triangle base.

## 0.2.4 — 2026-11-11
Build: v0.2.4+261111c
Type: feat
Commit: bb8cdc0
- Open the logo triangle by removing its base and replace it with a contour line; apply the same geometry to the favicon.

## 0.2.3 — 2026-11-11
Build: v0.2.3+261111b
Type: feat
Commit: 4db152d
- Turn the automatic theme dark after nightfall using a local 19:00–07:00 rule, applied before first paint and re-checked every thirty seconds.

## 0.2.2 — 2026-11-11
Build: v0.2.2+261111a
Type: feat
Commit: df92c88
- Replace the logo mark with the contour geometry and add the site favicon.

## 0.2.1 — 2026-11-11
Build: v0.2.1+2611119
Type: feat
Commit: 133f308
- Adopt the Alfazen platform color scheme across light, dark, and automatic themes.

## 0.2.0 — 2026-11-11
Build: v0.2.0+2611118
Type: fix
Commit: 80166bf
- Remove the duplicate role readout from the footer.

## 0.1.9 — 2026-11-11
Build: v0.1.9+2611117
Type: fix
Commit: 17ddf66
- List Disclaimer before About in the footer.

## 0.1.8 — 2026-11-11
Build: v0.1.8+2611116
Type: fix
Commit: 412ecbe
- Replace competing theme controls with one slot that cycles automatic, light, and dark.

## 0.1.7 — 2026-11-11
Build: v0.1.7+2611115
Type: feat
Commit: e3cd696
- Move About and Disclaimer into a centered Alfazen footer.

## 0.1.6 — 2026-11-11
Build: v0.1.6+2611114
Type: feat
Commit: 6a2b48e
- Rebuild the web interface as a survey instrument with a map-led landing page and workspace.

## 0.1.5 — 2026-11-11
Build: v0.1.5+2611113
Type: feat
Commit: 4bc6cac
- Add the area dashboard and workspace footer.

## 0.1.4 — 2026-11-11
Build: v0.1.4+2611112
Type: fix
Commit: 0463f3d
- Polish the map-led explorer interface.

## 0.1.3 — 2026-11-11
Build: v0.1.3+2611111
Type: feat
Commit: 6fb8da8
- Build the governed well workflow: staging, QC, review, publication, alias search, map display, and original-file download.

## 0.1.0 — 2026-11-10
Build: v0.1.0+2611101 → v0.1.2+2611103
Type: chore
Commit: d774d4d
- Initialize Atlasio with the prefixed Alfazen versioning policy.
- Add the project README and the Apache 2.0 license.
- Choose the Rust core and record the first-slice plan.
