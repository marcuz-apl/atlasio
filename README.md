# Atlasio

Atlasio is a planned governed subsurface data workspace. It aims to help teams stage, review, publish, and find technical data, with a map for discovery and inspection. Source files, provenance, dataset versions, permissions, and coordinate integrity are central to the product.

The project is in its first implementation slice; there is no verified application to run yet. This slice will take a well package through staging, quality checks, review, publication, search, and map display. The core is intended for global use and will be tested with material from multiple countries.

## Project documents

- [Product requirements](PRD.md) define Release 1, workflows, and open decisions.
- [Agent instructions](AGENTS.md) record implementation constraints and domain invariants.
- [Versioning](docs/versioning.md) explains the `VERSION` file, patch bumps, and commit hooks.
- [Implementation milestones](docs/implementation-roadmap.md) sequence Release 1 work.
- [Rust core decision](docs/decisions/0001-rust-core.md) records the chosen backend direction and the open desktop question.

## License

Apache License 2.0. See [LICENSE](LICENSE).
