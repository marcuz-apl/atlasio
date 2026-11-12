# Backup and restore rehearsal

Atlasio exposes the routine path in the admin panel at `#/admin`. Administrators and Data Managers can create a backup, download the dump, and verify it; re-verification restores the archive into a scratch database and compares record counts. Only an Administrator can delete a backup or restore the live database, and a restore requires typing `RESTORE <backup id>`, takes a fresh pre-restore backup, verifies the archive checksum, and pauses non-admin sessions until it finishes. With local object storage the archive also contains the original files; with S3 it contains the database dump, so pair it with a provider snapshot.

The procedure below remains the manual rehearsal for a production environment. Atlasio metadata and original objects form one recoverable dataset. Stop writes or take coordinated database and object-store snapshots before a production backup. Retain the database dump and the corresponding object-store version or snapshot together; verify checksums after restore.

The local rehearsal used the synthetic integration stack. It restored a `pg_dump -Fc` snapshot into a separate database, compared well/version/migration counts, copied an original object into a separate S3Mock bucket, and checked its SHA-256 against `file_assets.sha256`. It also confirmed that SQL triggers reject edits to published versions, batches, and files. This proves a local recovery path for the tested data; it does not validate backup consistency under concurrent writes or a production object-store recovery process.

```sh
docker compose exec -T db pg_dump -U atlasio -d atlasio -Fc > atlasio.dump
docker compose exec -T db createdb -U atlasio atlasio_restore_check
docker compose exec -T db pg_restore -U atlasio -d atlasio_restore_check --no-owner --no-privileges < atlasio.dump
```

Restore the matching object-store snapshot to an isolated bucket. For each restored `file_assets.object_key`, fetch its bytes and compare SHA-256 with the restored `sha256` column before opening the restored system to users. Point the recovered server at the restored database and bucket, then exercise search, record access, and an authorized original-file download. Retain the original environment until the recovery is accepted.
