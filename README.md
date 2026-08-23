# proton-mcp

A self-hosted Model Context Protocol (MCP) server for Proton Mail, designed to run next to Proton Mail Bridge and expose a small, auditable set of mailbox tools to MCP clients.

> **Status:** early development. `v0.1` is intentionally read-only. Streamable HTTP and stdio transports are available; mailbox tools are still being implemented.

## Goals

- Run continuously on a NAS or home server with Docker Compose.
- Keep Proton Mail Bridge isolated from the LAN and internet.
- Talk to Bridge over local IMAP/SMTP rather than handling Proton encryption directly.
- Expose narrow MCP tools instead of generic shell or filesystem access.
- Make mailbox cleanup efficient by returning metadata first and full message bodies only on demand.
- Add controlled write actions only after the read-only interface is well tested.

## Planned v0.1 tools

- `list_folders`
- `mailbox_stats`
- `top_senders`
- `search_mail`
- `get_message`

See [`docs/SPEC.md`](docs/SPEC.md) for the tool contract and [`ARCHITECTURE.md`](ARCHITECTURE.md) for the deployment model.

## Transports

The container defaults to authenticated Streamable HTTP:

```text
POST /mcp
GET  /healthz
```

Runtime configuration:

```text
MCP_HOST=0.0.0.0
MCP_PORT=3000
MCP_AUTH_TOKEN_FILE=/run/secrets/mcp_auth_token
MCP_ALLOWED_HOSTS=localhost,127.0.0.1,[::1]
MCP_ALLOWED_ORIGINS=
```

`MCP_AUTH_TOKEN_FILE` must contain a bearer token of at least 32 characters. Keep it in a mounted secret file rather than committing it or putting it in Compose environment values.

`MCP_ALLOWED_HOSTS` is a comma-separated hostname allowlist. If a reverse proxy preserves a public hostname, add that hostname explicitly. Browser requests carrying an `Origin` header are rejected unless that exact origin is present in `MCP_ALLOWED_ORIGINS`; normal non-browser MCP clients usually send no Origin header.

For local child-process clients, stdio remains available:

```bash
node dist/index.js stdio
```

For development:

```bash
npm run dev       # stdio
npm run dev:http  # Streamable HTTP
```

## Deployment model

```text
MCP client
    |
    | authenticated Streamable HTTP
    v
proton-mcp container
    |
    | localhost IMAP
    v
proton-bridge container
    |
    v
Proton Mail
```

The intended Docker Compose deployment gives `proton-mcp` and `proton-bridge` a shared network namespace so Bridge can remain bound to loopback. IMAP/SMTP ports must not be published to the LAN. The MCP HTTP port should be published only to the intended trusted path, such as host loopback for a local reverse proxy.

## Development principles

- No Proton account password in the repository, image, logs, or normal environment variables.
- No arbitrary shell MCP tool.
- No destructive MCP tools in `v0.1`.
- Prefer deterministic mailbox processing to sending large volumes of email content to an LLM.
- Keep validation simple: future agents should be able to run one command (`make check`) before finishing work.

## Documentation

- [`AGENTS.md`](AGENTS.md) — concise instructions for coding agents.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — system boundaries and decisions.
- [`SECURITY.md`](SECURITY.md) — security invariants.
- [`docs/SPEC.md`](docs/SPEC.md) — MCP tool contract.
- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) — local development workflow.
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md) — Synology / Docker operations.

## License

MIT. See [`LICENSE`](LICENSE).
