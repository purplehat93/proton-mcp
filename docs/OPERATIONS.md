# Operations

This document describes the intended Synology/Docker deployment.

## Prerequisites

Before deploying Proton Mail Bridge on the NAS, verify CPU architecture:

```bash
uname -m
```

The Bridge image/build approach must match an architecture supported by Proton Mail Bridge.

## Intended layout

Example host layout:

```text
/volume2/docker/appdata/proton-mail/
└── bridge/
    └── persistent state

/volume2/docker/secrets/proton-mail/
└── mcp_auth_token
```

Do not commit the live secret file, Bridge state, password store, GPG keyring, or generated Bridge credentials.

## Services

The deployment uses two containers:

- `proton-bridge`
- `proton-mcp`

The MCP container shares the Bridge network namespace so local IMAP/SMTP can remain bound to loopback. Because the MCP service shares that namespace, any MCP HTTP port mapping belongs on the `proton-bridge` service, which owns the namespace.

## Bridge bootstrap

Bridge requires a one-time account authentication/bootstrap before normal unattended operation:

1. initialize the Linux secret store/keyring;
2. start Bridge CLI;
3. authenticate to Proton, including 2FA when required;
4. persist Bridge state and secret-store data;
5. obtain the Bridge-generated local IMAP credentials for MCP use without storing the real Proton password in the MCP service.

Normal restarts reuse persisted Bridge state rather than repeating Proton login.

## MCP HTTP authentication

The production container defaults to Streamable HTTP on port `3000`. It refuses to start without a bearer token file of at least 32 characters.

Create a host secret with restrictive permissions, for example:

```bash
mkdir -p /volume2/docker/secrets/proton-mail
umask 077
openssl rand -hex 32 > /volume2/docker/secrets/proton-mail/mcp_auth_token
```

Mount that file as a Compose secret at `/run/secrets/mcp_auth_token`. Do not put the token directly in the Compose file or commit it to Git.

The HTTP surface is intentionally small:

```text
POST /mcp      authenticated MCP endpoint
GET  /healthz  unauthenticated liveness endpoint
```

`MCP_ALLOWED_HOSTS` controls accepted HTTP `Host` values. `MCP_ALLOWED_ORIGINS` is empty by default, which means browser requests that carry an `Origin` header are rejected. Add an origin only when a browser-based client genuinely needs it.

## Network policy

Never publish Bridge IMAP/SMTP ports in production Compose configuration.

Bad:

```yaml
ports:
  - "1143:1143"
  - "1025:1025"
```

Preferred concept:

```yaml
services:
  proton-bridge:
    ports:
      - "127.0.0.1:3000:3000"

  proton-mcp:
    network_mode: "service:proton-bridge"
```

This leaves Bridge's mail protocols private while making the authenticated MCP endpoint reachable only through host loopback. A local reverse proxy can later terminate HTTPS and forward to `127.0.0.1:3000`. If that proxy preserves a public `Host` header, add the hostname to `MCP_ALLOWED_HOSTS`.

Do not publish the MCP port to `0.0.0.0` merely to make remote access convenient. Use a deliberate authenticated HTTPS/private-network path.

## Local stdio mode

Streamable HTTP is the container default, but stdio remains available for clients that launch the server as a child process:

```bash
node dist/index.js stdio
```

## Updates

Bridge and MCP have independent release cycles. Keeping them in separate containers means either can be upgraded or rolled back without rebuilding the other.

For `proton-mcp`, tagged releases should produce corresponding GHCR image tags, for example:

```text
ghcr.io/purplehat93/proton-mcp:latest
ghcr.io/purplehat93/proton-mcp:v0.1.0
```

## Backups

Back up only the persistent runtime material needed to restore Bridge operation, and treat those backups as sensitive secrets. Back up the MCP bearer token only through an appropriately protected secrets-backup process. Do not include mailbox exports or Bridge state in normal source-control backups.

## Troubleshooting order

When the MCP cannot access mail, check in this order:

1. Is the Bridge container running?
2. Is Bridge authenticated and healthy?
3. Does `GET /healthz` succeed locally?
4. Does the MCP client have the correct bearer token?
5. Does the request `Host` match `MCP_ALLOWED_HOSTS`?
6. Can the MCP container reach the local IMAP port?
7. Are Bridge-generated IMAP credentials available and current?
8. Does a bounded read-only smoke test succeed?
9. Only then inspect MCP tool behavior.

This order avoids spending agent/model time debugging application code when the problem is actually Bridge state, authentication, or container networking.
