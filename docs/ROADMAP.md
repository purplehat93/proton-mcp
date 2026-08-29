# Roadmap

## Implemented

- Metadata-first mailbox discovery, inventory, cleanup candidates, newsletter
  signals, receipt extraction, and receipt candidates.
- Controlled explicit-id actions with dry-run support and no permanent delete.
- Expiring cleanup plans, operation history, and exact-only undo via IMAP UID
  mappings.
- Disabled-by-default manual automation rules, manual review runs, and rule
  lifecycle management.
- Review-only bulk cleanup manifests with bounded metadata scans and persisted
  candidate digests.
- One-confirmation bulk execution through internal 50-message plans, with
  persisted progress and operation history.

## Live-validated

- Bridge connectivity and authenticated MCP HTTP access.
- Automation no-match and pending-confirmation state flows.
- A one-message archive followed by exact undo back to INBOX.

## In review

- Scheduled review runs: interval-based, bounded candidate collection only. No
  background confirmation token, plan application, or mail mutation.

## Pending ideas

- Newsletter management: group by sender/List-ID, reviewable filing rules, and
  unsubscribe-link discovery. Never automatically follow unsubscribe links.
- Receipt management: persist extracted metadata, merchant/date/amount filters,
  CSV/JSON export, and optional reviewed filing rules.
- Outbound notifications: generic webhook integration for scheduler/Bridge
  failures, with Discord as a possible target. Keep notification content minimal.
- Scheduler hardening: per-rule cooldowns, overlap locks, retry policy, health
  visibility, and an emergency global disable.
- Rule matching improvements: List-ID and newsletter-header conditions, then
  carefully reviewed label/folder actions.
- Operational maintenance: protected backup coverage for the MCP state directory
  and periodic live smoke validation.

## Explicit non-goals

- Permanent delete.
- Arbitrary IMAP or shell execution.
- Background mailbox mutation without a separately approved design.
