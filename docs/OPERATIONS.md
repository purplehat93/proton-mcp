# Operations

This document describes the intended Synology/Docker deployment. Commands and paths may be refined once the target NAS architecture and Bridge image are finalized.

## Prerequisites

Before deploying Proton Mail Bridge on the NAS, verify CPU architecture:

```bash
uname -m
```

The Bridge image/build approach must match an architecture supported by Proton Mail Bridge.

## Intended layout

Example host layout:

```text
/volume2/docker/proton-mail/
├── compose.yaml
├── bridge/
│   └── persistent state
├── mcp/
│   └── secrets / runtime state if required
└── .env
```

Do not commit the live `.env`, Bridge state, password store, GPG keyring, or generated Bridge credentials.

## Services

The deployment uses two containers:

- `proton-bridge`
- `proton-mcp`

The MCP container shares the Bridge network namespace so local IMAP/SMTP can remain bound to loopback.

## Bridge bootstrap

Bridge requires a one-time account authentication/bootstrap before normal unattended operation. The final container wrapper should:

1. initialize any required Linux secret store/keyring;
2. start Bridge CLI;
3. allow the user to authenticate to Proton, including 2FA when required;
4. persist Bridge state and secret-store data;
5. obtain the Bridge-generated local IMAP credentials for MCP use without storing the real Proton password in the MCP service.

Normal restarts should reuse persisted Bridge state rather than repeating Proton login.

The exact bootstrap implementation will be documented once the Bridge container is chosen/built and tested.

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
proton-mcp:
  network_mode: "service:proton-bridge"
```

Then the MCP process can connect to Bridge via `127.0.0.1` in the shared namespace.

## Updates

Bridge and MCP have independent release cycles. Keeping them in separate containers means either can be upgraded or rolled back without rebuilding the other.

For `proton-mcp`, tagged releases should produce corresponding GHCR image tags, for example:

```text
ghcr.io/purplehat93/proton-mcp:latest
ghcr.io/purplehat93/proton-mcp:v0.1.0
```

## Backups

Back up only the persistent runtime material needed to restore Bridge operation, and treat those backups as sensitive secrets. Do not include mailbox exports or Bridge state in normal source-control backups.

## Troubleshooting order

When the MCP cannot access mail, check in this order:

1. Is the Bridge container running?
2. Is Bridge authenticated and healthy?
3. Can the MCP container reach the local IMAP port?
4. Are Bridge-generated IMAP credentials available and current?
5. Does a bounded read-only smoke test succeed?
6. Only then inspect MCP tool behavior.

This order avoids spending agent/model time debugging application code when the problem is actually Bridge state or container networking.
