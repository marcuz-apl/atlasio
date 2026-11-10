# Atlasio agent instructions

## Project context

Atlasio is a governed subsurface data workspace with a map-led way to discover and use the data. Read [PRD.md](PRD.md) before proposing architecture or building features. The map is a discovery and inspection surface; data stewardship, provenance, versioning, and coordinate integrity are the core product.

Atlasio is intended for companies in any country. Test the core with material from multiple regions and design for eventual extension to other GIS domains. Do not encode a single company, country, basin, datum, or petroleum vocabulary as an unchangeable global assumption.

## Scope and sequencing

1. Plan and deliver thin, working vertical slices. The first slice should take a well package through staging, QC, review, publication, search, and map display.
2. Treat the Release 1 requirements in `PRD.md` as the initial target. Subsequent-release items are roadmap items until the user explicitly prioritizes them.
3. Before starting a substantial feature, state its user workflow, acceptance checks, affected data contracts, and any migration impact.
4. When a requirement is ambiguous, make a documented, reversible assumption and proceed where safe. Ask the user only when a choice materially changes product behavior, licensing, data ownership, or irreversible architecture.
5. Keep product decisions in `PRD.md` or a linked decision record. Keep implementation plans separate from product requirements.

## Domain invariants

- Give each managed entity a stable internal ID. Store external IDs and name aliases separately.
- Preserve original files and source metadata. Link every normalized value and derivative to its origin where practical.
- Treat a published dataset version as immutable. Corrections create a new version. Keep drafts and approved versions visibly distinct.
- Keep source coordinates and source CRS. Store derived display coordinates and the exact transformation operation used; never overwrite the source position.
- Do not assume WGS 84 for missing CRS. Do not silently choose among competing datum transformations or transform vertical/depth references.
- Treat horizontal CRS, vertical datum, KB/DF/GL elevation reference, MD/TVD, units, and seismic time/depth domain as separate concepts.
- Keep well identity separate from wellbore identity. Detect possible duplicates and require human resolution.
- Store large seismic files in object storage or governed external storage; the database holds metadata, indexes, relationships, and checksums.
- Enforce authorization at the API and storage boundary, not just in the UI. Retain license and confidentiality metadata for source packages.

## Technical direction

- Start with PostgreSQL and PostGIS for the system of record, S3-compatible object storage for binaries, and a mature PROJ-based CRS engine. Validate these through a vertical slice before broadening the platform.
- Prefer explicit schemas and migrations over opaque document blobs for core entities and relationships.
- Expose stable APIs for import, review, records, search, and map queries. Keep domain rules in one place so map, search, and record pages agree.
- Use established standards and formats pragmatically. Evaluate PPDM, OSDU, Energistics, LAS, DLIS, SEG-Y, and GIS formats when a concrete workflow needs them; do not implement whole standards speculatively.
- Prefer dependencies that can run in a private or on-premises environment. Document any service that requires external connectivity.
- Do not invent sample well names, coordinates, or seismic assets that could be mistaken for real data. Label synthetic fixtures clearly, include a second-country fixture to catch local assumptions, and keep licensed customer data out of the repository.

## Quality and verification

- Test domain rules and transformations with representative edge cases, including missing CRS, alternate well names, duplicate candidates, and version replacement.
- Coordinate transformations require known control points and recorded tolerances approved for the relevant CRS/operation. Round-trip tests alone do not prove correctness.
- Exercise a complete user workflow in the running app before calling a vertical slice complete.
- Verify migrations and the restore path whenever data storage behavior changes.
- Report what was changed, how it was checked, and any remaining limitations. Do not claim support for a format or datum based only on a UI label or a catalog entry.

## Collaboration

- Keep changes focused and reviewable. Explain material schema or architectural choices in plain language.
- Preserve user data, existing files, and project history. Inspect the repository before altering its structure.
- Update `PRD.md` when the user changes product scope or priorities, and call out any resulting implementation impact.

## Version control

- Apply the Alfazen `versioning-prefixed` skill for this repository. Do not use `versioning-alfazen` or `versioning-classic` here.
- Keep root `VERSION` as plain `m.n.p`. Increment `p` for every `feat`, `fix`, or `perf` commit; documentation and maintenance commits leave it unchanged.
- Prefix each commit subject with `v{VERSION}` only. Put the UTC `yymmddc` build number in the `Alfazen-Build` trailer, never in the subject. See [versioning.md](docs/versioning.md) for the hook workflow.
- When a feature is complete and verified, commit it with its `VERSION` patch bump and push it without waiting for a separate request.
