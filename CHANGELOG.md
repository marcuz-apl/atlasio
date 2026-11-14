# Atlasio change log

Every released build, newest first. The Admin Panel at `#/admin` renders this file as the product's build history.

Maintenance rule: add the next version's section in the same `feat`, `fix`, or `perf` commit that bumps `VERSION`. Run `.githooks/alfazen-version id` to obtain the build identifier the commit hook will stamp. Keep bullets factual and user-visible; internal refactors that change no behaviour can be omitted.

## 0.1.43 — 2026-11-14
Build: v0.1.43+2611142
Type: feat
- Well headers carry the industry columns: folder, well symbol, drilling structure, operator, well datum name/value/unit (KB/GL/RF), TD (MD) with unit, bottom-hole X/Y, source latitude/longitude with their own geographic CRS, and spud/completion dates. All are preserved as provided and shown in the record inspector; the external ID field is labelled UWI.
- Import accepts three position modes: projected X/Y with a CRS, geographic lat/lon with a CRS, or both (a mismatch beyond 0.001 degrees warns). CRS aliases such as `ED50 / UTM zone 32N` normalize to their code; X/Y are no longer mandatory.
- New QC warnings that never block: missing datum or TD unit, datum name outside KB/GL/RF/DF, lat/lon without a geographic CRS, position mismatch, and non-ISO dates.
- Migration 008 adds the header columns and makes source X/Y nullable for geographic-only headers; published versions remain immutable.

## 0.1.42 — 2026-11-14
Build: v0.1.42+2611141
Type: feat
- The app serves on port 3040: the server binds `0.0.0.0:3040`, and the smoke, auth, admin, demo-well, and CRS verification scripts plus the README default to `http://localhost:3040`.
- `ATLASIO_URL` still overrides the script target, and the web client is unchanged because it calls same-origin `/api` paths.

## 0.1.41 — 2026-11-13
Build: v0.1.41+2611133
Type: fix
- Both documentation guides (the user guide at `#/docs` and the build notes at `#/admin/docs`) span 85% of the screen width on desktop and the full content width on narrow screens, instead of a narrow centered column.
- The site footer (Disclaimer, About, copyright) is visible on both guides; leaving Explore no longer keeps it hidden on documentation pages.
- Reading type is larger and calmer in both themes: 15px prose with 1.7 line height, 26px section headings, and proportionally larger tables, notes, decision cards, and references.

## 0.1.40 — 2026-11-13
Build: v0.1.40+2611131
Type: feat
- Import-time CRS transformation: native ED50 source positions (EPSG:4230 geographic, EPSG:23031/23032 UTM 31N/32N) are reprojected to WGS 84 for display using the verified EPSG:1311 operation (±1 m); source CRS and coordinates are preserved and the operation and accuracy are recorded on each published version.
- The importer offers the supported source CRS with CRS-aware axis labels and validation; the record inspector shows the applied operation and display accuracy.
- Positions outside the verified area of EPSG:1311 and unregistered CRS are blocked at QC instead of being silently transformed.

## 0.1.39 — 2026-11-12
Build: v0.1.39+261112y
Type: fix
- In Records, Review, and Ingest the mode control aligns with the cards' left edge on the content grid, while Explore keeps its floating map-edge inset; the vertical gap below the header is unchanged in every mode.

## 0.1.38 — 2026-11-12
Build: v0.1.38+261112x
Type: fix
- The Workspace mode control (Explore / Records / Ingest / Review) now sits at the same top-left position with the same 16px padding below the header in every mode, instead of jumping to the top-right outside Explore.
- Remove the Workspace hero title and lede; the mode bar is the workspace's only head, with the map chrome re-spaced beneath it.

## 0.1.37 — 2026-11-12
Build: v0.1.37+261112w
Type: fix
- Records now refreshes with the active query every time it is opened, so returning from the inspector bridge or another tab never shows stale rows or a broken table.
- A denied full-screen request shows a calm notice instead of an unhandled promise error.

## 0.1.36 — 2026-11-12
Build: v0.1.36+261112v
Type: feat
- Explore becomes a full-bleed map beneath the header: floating toolbar, basemap gallery with an offline vector fallback, live display controls, catalog drawer, quick search, coordinate rail, and PNG export.
- The record inspector gains Open in Records and Copy well ID, bridging map discovery to stewardship.
- Ingest gains Pick on map: an explicit pick fills X/Y and sets the source CRS to EPSG:4326; native-CRS entry by typing is unchanged.
- Version hooks fall back to a working Python interpreter where `python3` is a non-functional stub.

## 0.1.35 — 2026-11-12
Build: v0.1.35+261112u
Type: feat
- Remove the area-of-interest helper line so the control is compact and the catalog and map start higher.

## 0.1.34 — 2026-11-12
Build: v0.1.34+261112r
Type: feat
- Tighten the dashboard hero: reduce the title, keep the summary on one line, and start the catalog and map higher.

## 0.1.33 — 2026-11-12
Build: v0.1.33+261112q
Type: feat
- Let the shared page shell fill the viewport, so the header, workspace, and footer use the full screen width minus the responsive gutter.

## 0.1.32 — 2026-11-12
Build: v0.1.32+261112k
Type: feat
- Replace the Horizontal Wells tile with Deviation Surveys under Well Data. Well orientation becomes an attribute derived from the survey rather than a separate category.
- Document the change in both guides without changing the twenty-five-category count.

## 0.1.31 — 2026-11-12
Build: v0.1.31+261112i
Type: feat
- Rename the viewer demo key to `viewer-demo`, with a migration that updates the seeded profile.
- Shorten the seeded staff passwords to `admin-initial` and `datamgr-initial`.
- Record the catalog taxonomy decision and add glossary entries for well versions, source files, DST, and core samples.

## 0.1.30 — 2026-11-12
Build: v0.1.30+261112h
Type: feat
- Remove the E&P Projects tile from Well Data and rename Original Files to Source Files.
- Add DST Records under Drilling & Completions and Core & Sample Records under Well Data as planned categories.
- Explain in the guides that Wells counts current wells while Well Versions counts every published version, including corrections.

## 0.1.29 — 2026-11-12
Build: v0.1.29+261112g
Type: feat
- Put GIS & Basemaps first under Culture & Lands, and Production Tests first under Production Data.

## 0.1.28 — 2026-11-12
Build: v0.1.28+261112f
Type: feat
- Add the operator-only command `atlasio-server reset-mfa <username>` for a lost authenticator and recovery codes. It clears that account's MFA, lockout, and sessions, keeps the password, writes an `auth.mfa.reset` audit entry, and exits without restarting the service.
- No reset state lives in the environment, so a normal restart can never strip MFA.

## 0.1.27 — 2026-11-12
Build: v0.1.27+261112e
Type: fix
- Stop Chrome from restoring the previous staff username or password on the sign-in gate. The fields stay read-only until you click or tab into them, so autofill has nothing to fill.

## 0.1.26 — 2026-11-12
Build: v0.1.26+261112d
Type: feat
- Show the header tagline "Governed subsurface data, in place" beside the logo on the sign-in gate.
- Clear the staff username, password, and authenticator fields whenever the sign-in gate reappears, and turn off browser autocomplete for them.

## 0.1.25 — 2026-11-12
Build: v0.1.25+261112c
Type: feat
- Give multi-factor authentication its own account-menu entry beside Change password, instead of hiding it inside the password dialog.
- Label the entry Set up MFA until an authenticator is enrolled, then Manage MFA.

## 0.1.24 — 2026-11-12
Build: v0.1.24+261112b
Type: feat
- Split the reference page by audience. Signed-in viewers, importers, and reviewers now get a user guide at `#/docs` covering roles, dashboard, map inspection, search, ingest, review, and account security.
- Move the build notes and decision records to `#/admin/docs`, linked from the Administration panel and limited to Administrators and Data Managers.
- Show the header Docs link after sign-in only, remove the build-notes link from the sign-in gate, and add a back link from the build notes to Administration.

## 0.1.23 — 2026-11-12
Build: v0.1.23+261112a
Type: fix
- Lower the new-password minimum from 12 to 8 characters, in both the server rule and the password dialog.

## 0.1.22 — 2026-11-12
Build: v0.1.22+2611129
Type: feat
- Replace the staff access chip's dialog with an account menu: User profile, Change password, and Log out.
- Show account details in User profile, and manage the authenticator app from Change password.
- Collapse the Admin Panel change log and audit trail by default, with Show/Hide controls that keep their entry counts visible.

## 0.1.21 — 2026-11-12
Build: v0.1.21+2611128
Type: feat
- Replace shared Administrator and Data Manager access keys with username/password accounts seeded once from the environment, hashed with Argon2id.
- Require the initial password to be changed at first sign-in; a persistent banner blocks privileged changes until it is, and the audit trail records the person who acted.
- Add opaque twelve-hour sessions with sign-out, a five-attempt lockout, and a gate sign-in form; viewer, importer, and reviewer keys keep working as before.
- Add optional TOTP MFA with a QR enrolment, one-time recovery codes, and password-confirmed disable; `ATLASIO_MFA_REQUIRED=1` blocks privileged changes until an account enrols.
- Encrypt authenticator secrets with `ATLASIO_MFA_KEY`, show account and MFA counts in the Admin Panel, and clear MFA on an explicit password reset.

## 0.1.20 — 2026-11-12
Build: v0.1.20+2611127
Type: fix
- Replace the header descriptor with the approved promise: Governed subsurface data, in place.
- Use the same line in the About dialog and drop its terminal period, matching the display rule.

## 0.1.19 — 2026-11-12
Build: v0.1.19+2611125
Type: feat
Commit: 1c288db
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
