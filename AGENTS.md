# AGENTS.md

Keep this file short. Read the linked docs before changing architecture or behavior.

## Before editing

1. Read `ARCHITECTURE.md`.
2. Read `docs/SPEC.md` for tool contracts.
3. Read `SECURITY.md` before touching networking, credentials, Bridge integration, or write actions.
4. Read `docs/DEVELOPMENT.md` for validation commands.

## Rules

- `v0.1` is read-only. Do not add mailbox mutations unless explicitly requested.
- Never expose Proton Mail Bridge IMAP/SMTP ports to the LAN or internet.
- Never commit Proton credentials, Bridge-generated credentials, tokens, keyrings, vault files, or mailbox data.
- Never add a generic shell/command-execution MCP tool.
- Prefer small, explicit MCP tools with bounded outputs.
- Metadata-first: do not fetch or return full message bodies unless the caller explicitly requests a message.
- Preserve existing tool schemas unless the task explicitly changes the contract.
- Do not redesign the two-container architecture without an explicit request.

## Validation

Before finishing a code change, run:

```bash
make check
```

If the change affects container/runtime behavior, also run:

```bash
make docker-check
```

When a real Bridge is available, use the non-destructive smoke test described in `docs/DEVELOPMENT.md`.
