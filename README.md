# Atlasio

Atlasio is a governed subsurface data workspace. Its first working slice lets a team stage a well header and original file, resolve QC findings, review and publish an immutable version, then find that well through search or an offline map. Source files, provenance, dataset versions, permissions, and coordinate integrity are central to the product.

The core is intended for global use and has synthetic fixtures from two countries. Release 1 remains in progress; see [PRD.md](PRD.md) for its broader requirements.

## Run the first slice

Requires Docker Compose, a Rust toolchain, and Node.js/npm. From the repository root:

```sh
docker compose up -d
npm --prefix web ci
npm --prefix web run build
./scripts/dev-server.sh
```

Open `http://localhost:8000`. Local demo keys are `importer-demo`, `reviewer-demo`, and `reader-demo`. In another terminal, run `node scripts/smoke.mjs` to exercise the two synthetic packages, version replacement, search, map API, download, and access checks. The demo PostgreSQL and S3Mock services retain state in Docker volumes. S3Mock is a development test service.

Only an explicitly supplied `EPSG:4326` source position can be published in this slice. Missing and other CRSs block submission pending a verified operation; no datum or vertical conversion is inferred. The upload limit is 5 MiB. Demo API keys, coarse public/restricted access, header-only metadata, and alias/ID duplicate checks are not the full Release 1 identity, file-format, spatial-duplicate, or authorization design. Do not use the demo credentials or S3Mock for production data.

The [backup and restore rehearsal](docs/operations/backup-restore.md) describes how metadata and original objects are recovered together.

## Project documents

- [Product requirements](PRD.md) define Release 1, workflows, and open decisions.
- [Agent instructions](AGENTS.md) record implementation constraints and domain invariants.
- [Versioning](docs/versioning.md) explains the `VERSION` file, patch bumps, and commit hooks.
- [Implementation milestones](docs/implementation-roadmap.md) sequence Release 1 work.
- [Rust core decision](docs/decisions/0001-rust-core.md) records the chosen backend direction and the open desktop question.

## License

Apache License 2.0. See [LICENSE](LICENSE).
