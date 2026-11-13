# Atlasio versioning

Atlasio uses the Alfazen `versioning-prefixed` policy. The tracked `VERSION` file starts at `0.1.0` and contains only `m.n.p`. Each commit subject starts with the version only, for example `v0.1.0 docs: update guide`. The UTC build identifier appears in an `Alfazen-Build` Git trailer, such as `Alfazen-Build: v0.1.0+2611102`.

For each `feat`, `fix`, or `perf` commit, increment `p` once and include the updated `VERSION` in that commit. Atlasio's explicit rule makes `feat` a patch bump. Documentation and maintenance commits leave `VERSION` unchanged. The commit hook checks these rules against the preceding commit.

Run `.githooks/alfazen-version bump` before staging a feature or fix. The `prepare-commit-msg` hook prefixes the subject and stamps the trailer; its daily counter advances with each commit. After cloning, enable the hooks with `git config core.hooksPath .githooks`.

## Publishing a release

A version is not released until it is tagged and published on GitHub. After the last commit of a version is pushed, create an annotated tag `v{VERSION}` at that commit and publish a GitHub Release titled `Atlasio v{VERSION}` whose notes are the version's CHANGELOG.md section. Push tags with `git push origin --tags`. When several versions were pushed without releases, backfill them in ascending order so the newest release is marked latest. The Admin Panel change log and the GitHub releases page must agree.
