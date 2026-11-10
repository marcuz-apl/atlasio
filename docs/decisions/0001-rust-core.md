# Decision 0001: Rust core and server

**Status:** Accepted, 2026-11-10

Atlasio will use Rust for shared domain rules and the backend API. PostgreSQL/PostGIS remains the system of record, S3-compatible storage holds original binaries, and the browser interface remains a locally bundled web client. The first implementation slice will prove this combination before broader features are added.

A future desktop edition may reuse Rust domain code and web interface components. Whether it connects to a private server or supports offline work remains open; offline storage, synchronization, conflict handling, and license enforcement require a separate product decision.

Python is not a runtime dependency for Atlasio's core or backend. Optional specialist tools may integrate through governed APIs later if a concrete workflow requires them.
