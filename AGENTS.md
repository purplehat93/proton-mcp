# AGENTS.md

Keep this file short. Read the linked docs before changing architecture or behavior.

## Before editing

1. Read `ARCHITECTURE.md`.
2. Read `docs/SPEC.md` for tool contracts.
3. Read `SECURITY.md` before touching networking, credentials, Bridge integration, or write actions.
4. Read `docs/DEVELOPMENT.md` for validation commands.
5. If the deployment repository `nmousouros/nas-infrastructure` is available in the same workspace, read its `STATE.md` and `stacks/proton-mail/AGENTS.md` for the current live deployment state. Do not copy changing runtime facts into this repository.

## Repository boundary

This repository owns the MCP server implementation and its contracts. It does not own the live Synology deployment state or Proton Bridge image build.

Related repositories:

- `purplehat93/proton-bridge-docker` — headless Proton Mail Bridge image.
- `nmousouros/nas-infrastructure` — live Compose deployment and current runtime handoff.

When a task spans repositories, inspect the relevant source rather than inferring behavior from deployment documentation.

## Rules

- Controlled mailbox mutations require explicit user approval, bounded opaque ids,
  and the review/confirmation workflow. Do not add unattended mutation paths
  without an explicit safety design.
- Never expose Proton Mail Bridge IMAP/SMTP ports to the LAN or internet.
- Never commit Proton credentials, Bridge-generated credentials, tokens, keyrings, vault files, or mailbox data.
- Never add a generic shell/command-execution MCP tool.
- Prefer small, explicit MCP tools with bounded outputs.
- Metadata-first: do not fetch or return full message bodies unless the caller explicitly requests a message.
- Preserve existing tool schemas unless the task explicitly changes the contract.
- Do not redesign the two-container architecture without an explicit request.
- Runtime/deployment changes are not implied by source changes; do not assume permission to restart or modify the live NAS.

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
