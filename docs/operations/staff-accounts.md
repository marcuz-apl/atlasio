# Staff accounts and MFA recovery

Atlasio seeds one Administrator and one Data Manager account at startup from the environment. Passwords are hashed with Argon2id, and both accounts must replace the initial password at first sign-in. A persistent banner stays visible and privileged changes return 403 until the password is changed. Sessions are opaque tokens with a twelve-hour lifetime; five failed sign-ins lock the account for five minutes.

The two account usernames and initial passwords come from `ATLASIO_ADMIN_USERNAME`/`ATLASIO_ADMIN_INITIAL_PASSWORD` and `ATLASIO_DATAMGR_USERNAME`/`ATLASIO_DATAMGR_INITIAL_PASSWORD`. The initial password seeds an account once. Changing the environment value later has no effect until an explicit reset runs.

## Enrol and use MFA

Set `ATLASIO_MFA_KEY` to a base64-encoded 32-byte key to allow TOTP enrolment. Each account enrols from the account menu: **Set up MFA**, confirm the password, scan the QR code, and enter a six-digit code. Enrolment returns eight one-time recovery codes; store them separately from the phone because they are shown once.

**Manage MFA** disables the authenticator after the current password and a current authenticator or recovery code. Disabling revokes the account's other sessions. When `ATLASIO_MFA_REQUIRED=1`, privileged changes stay blocked until the account enrols.

## Recover a locked account

Use the first path that matches what is still available.

| Situation | Recovery |
| --- | --- |
| Phone lost, recovery codes available | Sign in with the password and one unused recovery code. That code is consumed. |
| Phone and recovery codes lost, password known | Run the operator command `atlasio-server reset-mfa <username>`. It clears MFA, recovery codes, lockout, and sessions, keeps the password, and writes an `auth.mfa.reset` audit entry. |
| Password lost as well | Start the service once with `ATLASIO_RESET_PASSWORDS=1`. It reissues both seeded passwords from the environment, clears MFA and sessions, and forces a change at next sign-in. |
| Both staff accounts locked | The same two operator paths apply per account. Neither account can reset the other from the interface. |

`reset-mfa` works while the service is running and needs `DATABASE_URL`:

```sh
DATABASE_URL=postgresql://atlasio:***@db:5432/atlasio atlasio-server reset-mfa admin
```

For the local dev stack:

```sh
wsl -e sh -lc 'cd /mnt/e/projects/atlasio && DATABASE_URL=postgresql://atlasio:local-demo-only@localhost:5432/atlasio cargo run -p atlasio-server -- reset-mfa datamgr'
```

The command prints whether it cleared anything and exits. A second run reports that MFA is already off. There is no self-service bypass and no standing environment flag, so a normal restart never removes MFA.

Remove `ATLASIO_RESET_PASSWORDS=1` after the recovery start. If it stays in a unit file or compose file, every restart reissues the passwords and clears MFA again.

## After recovery

Sign in with the initial password, choose a new password of at least eight characters, and enrol the authenticator again if the deployment requires MFA. Save the new recovery codes before closing the dialog. Existing sessions were revoked by the reset, so other devices must sign in again.

## Audit actions

The administrative audit trail records `auth.account.bootstrap`, `auth.login`, `auth.password.change`, `auth.password.reset`, `auth.mfa.start`, `auth.mfa.enable`, `auth.mfa.disable`, and `auth.mfa.reset`. A password or MFA reset is attributed to `system` with the username and role in the details.
