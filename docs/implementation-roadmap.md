# Release 1 implementation milestones

This sequence implements [Release 1](../PRD.md) in thin, testable slices. Product requirements remain in the PRD.

1. **Well package workflow:** stage a header and original file, run QC, correct metadata, resolve identity in review, publish an immutable well version, and find it by search and map. See the [first-slice plan](superpowers/plans/2026-11-10-well-workflow.md).
2. **Coordinate and well depth:** verify pilot CRS operations with reviewed control points, add source formats and well content needed for actual packages, and expand version comparison.
3. **Seismic catalog:** register surveys, footprints, navigation and large-file references; search and inspect them without downloading cubes.
4. **Operational hardening:** strengthen identity and access integration, license enforcement, audit, private deployment, and database plus object-storage restore exercises.
