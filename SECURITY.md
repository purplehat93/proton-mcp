# Security

Security decisions in this project are architectural constraints, not optional defaults.

## Invariants

- Never commit Proton account passwords.
- Never commit Bridge-generated IMAP/SMTP credentials.
- Never commit Bridge vault/state, GPG keyrings, password stores, access tokens, cookies, mailbox exports, or real email fixtures.
- Do not publish Bridge IMAP/SMTP ports to the host LAN or internet.
- Do not expose an unauthenticated MCP endpoint outside a trusted local environment.
- Do not add arbitrary shell or arbitrary IMAP execution tools.
- `v0.1` contains no mailbox mutation tools.
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

When write tools are introduced:

- prefer reversible actions such as archive/move-to-trash;
- require explicit message identifiers or an explicit bounded query contract;
- impose maximum batch sizes;
- return a clear operation summary;
- do not silently expand a selection;
- keep permanent deletion separate and disabled by default.

## Reporting vulnerabilities

Do not include real mailbox contents, credentials, tokens, or Bridge state in public issues. Describe the reproduction with synthetic data and redact sensitive logs.
