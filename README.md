# proton-mcp

A self-hosted Model Context Protocol (MCP) server for Proton Mail, designed to run next to Proton Mail Bridge and expose a small, auditable set of mailbox tools to MCP clients.

> **Status:** early development. Bounded metadata tools, controlled explicit-id writes, and the reviewable cleanup workflow are implemented. Live deployment status is tracked separately from this source repository.

## Goals

- Run continuously on a NAS or home server with Docker Compose.
- Keep Proton Mail Bridge isolated from the LAN and internet.
- Talk to Bridge over local IMAP/SMTP rather than handling Proton encryption directly.
- Expose narrow MCP tools instead of generic shell or filesystem access.
- Make mailbox cleanup efficient by returning metadata first and full message bodies only on demand.
- Keep mutations explicit, bounded, reviewable, and reversible where IMAP can prove an exact reversal.

## v0.1 tools

- `list_folders`
- `mailbox_stats`
- `top_senders`
- `mailbox_inventory`
- `cleanup_candidates`
- `mailbox_analysis`
- `search_mail`
- `get_message`
- `extract_receipt`
- `receipt_candidates`

Controlled management tools are also available for bounded, explicit-id
operations: `mark_read`, `mark_unread`, `archive_messages`, `move_messages`,
`copy_messages`, and `trash_messages`. They support `dryRun`; permanent deletion
is not exposed.

For reviewed batches, use `create_cleanup_plan` followed by
`apply_cleanup_plan`. Plans expire after 15 minutes and require a one-time
confirmation token. `cleanup_history` and `undo_cleanup_operation` are available
only for completed operations; undo is offered only when Bridge returns exact
destination UID mappings.

Manual automation rules are available through `create_automation_rule`,
`prepare_automation_run`, and `automation_history`. Rules are disabled by
default, never run on a schedule, and prepare a reviewable cleanup plan rather
than changing mail directly.

Disabled rules can be changed with `update_automation_rule` or removed with
`delete_automation_rule`, which also cancels any unused plan from that rule.

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

`MCP_ALLOWED_HOSTS` is a comma-separated hostname allowlist. If a reverse proxy preserves an external hostname, add that hostname explicitly. Browser requests carrying an `Origin` header are rejected unless that exact origin is present in `MCP_ALLOWED_ORIGINS`; normal non-browser MCP clients usually send no Origin header.

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

The live Synology deployment is maintained separately in `nmousouros/nas-infrastructure`, under `stacks/proton-mail/`. When that repository is available in the same workspace, its root `STATE.md` is the source of truth for changing runtime facts such as deployment status, live ports, Bridge sync state, and which tools have been validated against the real mailbox. Do not duplicate those changing facts here.

The Bridge image itself is maintained in [`purplehat93/proton-bridge-docker`](https://github.com/purplehat93/proton-bridge-docker).

## Development principles

- No Proton account password in the repository, image, logs, or normal environment variables.
- No arbitrary shell MCP tool.
- No destructive MCP tools in `v0.1`.
- Prefer deterministic mailbox processing to sending large volumes of email content to an LLM.
- Keep validation simple: future agents should be able to run one command (`make check`) before finishing work.
- A source change in this repository is not permission to deploy or restart the live NAS stack.

## Documentation

- [`AGENTS.md`](AGENTS.md) — concise instructions for coding agents.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — system boundaries and decisions.
- [`SECURITY.md`](SECURITY.md) — security invariants.
- [`docs/SPEC.md`](docs/SPEC.md) — MCP tool contract.
- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) — local development workflow.
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md) — Synology / Docker operations.

## License

MIT. See [`LICENSE`](LICENSE).
