# Security

Security decisions in this project are architectural constraints, not optional defaults.

## Invariants

- Never commit Proton account passwords.
- Never commit Bridge-generated IMAP/SMTP credentials.
- Never commit Bridge vault/state, GPG keyrings, password stores, access tokens, cookies, mailbox exports, or real email fixtures.
- Do not publish Bridge IMAP/SMTP ports to the host LAN or internet.
- Do not expose an unauthenticated MCP endpoint outside a trusted local environment.
- Do not add arbitrary shell or arbitrary IMAP execution tools.
- Permanent delete is not an initial feature.

## Secrets

Proton account authentication belongs to the Bridge bootstrap process. The MCP service should receive only the local credentials required to authenticate to Bridge.

Production deployment should use mounted secret files or another dedicated secret mechanism rather than plaintext values committed to Compose files. `.env.example` may document variable names but must never contain real values.

## Network exposure

Preferred topology:

```text
Bridge IMAP/SMTP -> loopback/shared container namespace only
MCP endpoint     -> trusted/authenticated client path only
```

If remote MCP access is added, use an authenticated private path such as a VPN/private overlay or a properly authenticated HTTPS reverse proxy. Do not solve remote access by publishing Bridge itself.

## Mail content

Mailbox contents are sensitive data. Tools should return the minimum content required for the task:

- bulk/list/search operations return metadata and snippets where explicitly useful;
- full bodies are returned only for specific message requests;
- logs must avoid subjects/bodies/addresses unless explicitly running a diagnostic mode in a trusted environment;
- tests use synthetic fixtures only.

## Write actions

The controlled write surface currently uses explicit opaque message ids, a hard
batch limit of 50, mailbox UIDVALIDITY checks, and optional dry-run mode. It does
not accept arbitrary IMAP searches as mutation commands, which prevents a
changing mailbox from silently expanding a bulk operation.

The cleanup workflow stores only plan metadata, opaque ids, token hashes, and
operation status in `MCP_STATE_DIR`; it never stores message bodies, credentials,
or bearer tokens. The directory must be private to the MCP service. Plans are
single-use and expire after 15 minutes. An interrupted apply or undo is marked
`needs_review` and is never retried automatically. Undo is exposed only when
Bridge returns a complete UIDPLUS mapping, so destination UIDs are never guessed.

Automation rules are metadata-only, disabled by default, and have no scheduler
or background worker. Each manual evaluation is bounded to 50 messages and must
create a separate one-time cleanup plan before a mail mutation can occur. Rules
cannot use full-body text matching or permanent deletion.

Any future scheduler must be evaluation-only: it may record bounded opaque ids
for review but must never create a usable confirmation token or mutate mail in
the background. Outbound notification integrations must use scoped secrets and
must not include message bodies, full subjects, or addresses by default.

## Reporting vulnerabilities

Do not include real mailbox contents, credentials, tokens, or Bridge state in public issues. Describe the reproduction with synthetic data and redact sensitive logs.
