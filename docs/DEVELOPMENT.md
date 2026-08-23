# Development

## Intended stack

- Node.js 20+
- TypeScript
- MCP TypeScript SDK
- IMAP client library
- Schema validation for all MCP inputs
- Synthetic fixtures only in tests

Exact dependency versions belong in `package.json` and should be updated deliberately rather than copied from documentation examples.

## Commands

The repository should converge on these stable entry points:

```bash
make install
make dev
make test
make lint
make typecheck
make check
make docker-check
make smoke
```

`make check` is the normal completion criterion for code changes. It should remain fast enough to run routinely and should cover formatting/linting, type checking, and tests.

`make docker-check` should build the production image and validate the example Compose file without requiring real credentials.

`make smoke` is reserved for a configured environment with a real Proton Bridge. It must remain read-only during `v0.1`.

## Agent workflow

For future coding-agent tasks, prefer a short request such as:

```text
Implement issue #12. Follow AGENTS.md. Run make check and fix failures before finishing.
```

Do not repeat architecture or security policy in every prompt; keep those decisions in the repository docs.

## Local development without Proton

Most implementation should be testable without a real mailbox by isolating IMAP behind an adapter and using synthetic fixtures/mocks.

Suggested layers:

```text
MCP tool handlers
      |
      v
mail service/domain layer
      |
      v
IMAP adapter interface
      |
      +--> real Bridge adapter
      +--> test fake
```

This separation lets CI exercise tool validation and result shaping without needing Proton credentials.

## Real Bridge smoke testing

Once Bridge is configured, smoke tests may verify only non-destructive operations such as:

1. connect/authenticate to local Bridge IMAP;
2. list folders;
3. fetch mailbox counts;
4. perform a deliberately bounded search;
5. disconnect cleanly.

The smoke command must not mark messages read, move messages, delete messages, or send mail in `v0.1`.

## Logging

Normal logs should include operational information such as connection state, tool name, timings, result counts, and errors. Avoid logging message bodies, credentials, or complete addresses/subjects by default.
