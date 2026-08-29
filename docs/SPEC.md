# Tool Specification

This document defines the public MCP contract for the first release. Implementation changes must preserve these semantics unless the spec is explicitly changed first.

## General rules

- The service has bounded read-only tools and controlled explicit-id write tools.
- All list/search results are bounded.
- Bulk operations return metadata, not full message bodies.
- Message identifiers returned by this service are opaque to MCP clients.
- Dates use ISO 8601 strings.
- Errors should be concise, actionable, and must not include credentials.

## Common message summary

Where a tool returns message summaries, use the following logical shape:

```json
{
  "id": "opaque-message-id",
  "folder": "Inbox",
  "from": {
    "name": "Example Sender",
    "address": "sender@example.com"
  },
  "subject": "Example subject",
  "receivedAt": "2026-08-23T17:15:00Z",
  "size": 12345,
  "seen": false,
  "hasAttachments": false
}
```

The implementation may add stable, documented fields later without changing the meaning of existing fields.

## `list_folders`

Lists mailbox folders/labels visible through Bridge.

Input:

```json
{}
```

Output:

```json
{
  "folders": [
    {
      "name": "Inbox",
      "path": "Inbox",
      "specialUse": "inbox"
    }
  ]
}
```

Notes:

- Do not enumerate message bodies or message summaries.
- Preserve the Bridge/IMAP folder path needed for later operations.

## `mailbox_stats`

Returns compact mailbox/folder counts.

Input:

```json
{
  "folder": "Inbox"
}
```

`folder` is optional. If absent, return an overall summary plus useful per-folder counts where inexpensive.

Output example:

```json
{
  "total": 12000,
  "unread": 42,
  "folders": [
    {
      "path": "Inbox",
      "total": 500,
      "unread": 20
    }
  ]
}
```

## `top_senders`

Aggregates message counts by sender without returning message bodies.

Input:

```json
{
  "folder": "Inbox",
  "before": "2025-01-01T00:00:00Z",
  "after": null,
  "limit": 50
}
```

Rules:

- `folder`, `before`, and `after` are optional.
- `limit` defaults to a conservative value and must have a hard maximum.
- Sort descending by message count.

Output:

```json
{
  "senders": [
    {
      "name": "Example Newsletter",
      "address": "news@example.com",
      "count": 250,
      "latestAt": "2024-12-20T10:00:00Z"
    }
  ]
}
```

## `search_mail`

Searches messages using bounded filters and returns summaries only.

Input logical shape:

```json
{
  "folder": "Inbox",
  "from": "news@example.com",
  "to": null,
  "subject": null,
  "text": null,
  "before": "2025-01-01T00:00:00Z",
  "after": null,
  "seen": null,
  "hasAttachments": null,
  "limit": 50
}
```

Rules:

- Every field except `limit` is optional.
- At least one useful narrowing criterion should be required for expensive searches unless a deliberately small folder/limit makes an unfiltered listing safe.
- `limit` must have a hard maximum.
- Return newest-first unless the implementation documents an explicit sort option.
- Do not return full bodies.

## `mailbox_inventory`

Builds a bounded metadata inventory for one folder.

Input:

```json
{
  "folder": "Inbox",
  "before": "2025-01-01T00:00:00Z",
  "after": null,
  "limit": 50,
  "scanLimit": 5000
}
```

Rules:

- `folder`, `before`, `after`, `limit`, and `scanLimit` are optional.
- `scanLimit` defaults to 5000 and cannot exceed 5000.
- The result includes the exact number of matching UIDs, but aggregates only the bounded sample.
- The scan fetches metadata only: envelopes, dates, flags, sizes, and attachment structure.
- No message bodies, attachment contents, or mailbox mutations are performed.

Output includes sampled unread/seen/attachment/size totals, date range, monthly
counts, top senders, and top sender domains, plus `truncated` metadata.

Output:

```json
{
  "messages": [],
  "truncated": false
}
```

## `get_message`

Fetches one specific message by opaque identifier.

Input:

```json
{
  "id": "opaque-message-id"
}
```

Output logical shape:

```json
{
  "id": "opaque-message-id",
  "folder": "Inbox",
  "from": [],
  "to": [],
  "cc": [],
  "subject": "Example subject",
  "receivedAt": "2026-08-23T17:15:00Z",
  "text": "Plain-text body where available",
  "html": null,
  "attachments": [
    {
      "filename": "invoice.pdf",
      "contentType": "application/pdf",
      "size": 12345
    }
  ]
}
```

Rules:

- Attachment metadata may be returned, but attachment binary content is out of scope for `v0.1`.
- Avoid returning duplicate HTML and text when doing so materially increases output size; the implementation should prefer a useful text representation.
- Apply a documented maximum body/output size and signal truncation rather than returning unbounded content.

## `extract_receipt`

Inspects one opaque message id using the same bounded text/HTML retrieval as
`get_message`. It returns heuristic receipt signals, merchant, order reference,
currency amounts, and attachment metadata. It never downloads attachment bytes
or changes mail; callers must treat the result as a review aid.

## `cleanup_candidates`

Returns bounded metadata-only messages that may be useful for cleanup review.
By default it excludes unread messages and identifies messages from senders that
occur at least 10 times in the scanned sample. `olderThanDays` adds an `old_read`
reason for read messages older than the requested age. `includeUnread` can widen
the scan, but the result remains a suggestion and never mutates mail.

The result includes `matched`, `scanned`, `truncated`, the effective criteria,
and message summaries with `reasons`. It is intentionally not a delete or
archive command.

## `receipt_candidates`

Scans at most 500 recent messages in one folder using envelopes only and returns
subject-line receipt signals. It does not fetch message bodies. Callers should
use `extract_receipt` on explicit candidates to inspect bounded content.

## `mailbox_analysis`

Performs a bounded metadata-only analysis of attachment types and sizes,
duplicate candidates, subject-based thread groups, and newsletter indicators
from `List-ID`, `List-Unsubscribe`, or bulk-precedence headers. Duplicate and
thread results are heuristics and require review. Message bodies and attachment
contents are never fetched.

## Controlled write tools

The controlled write tools accept `ids` from a previous search result and an
optional `dryRun` flag. `ids` must contain 1-50 unique opaque ids from one
source folder. The service validates mailbox UIDVALIDITY and confirms that all
selected messages still exist before changing mail.

## Cleanup workflow tools

`create_bulk_cleanup_run` performs a metadata-only scan of up to 12,000
messages, freezes the matching opaque ids into a persisted manifest, and
returns a review summary plus a manifest digest. It never changes mail and it
does not create a confirmation token. `bulk_cleanup_history` lists these
review-only manifests. Bulk execution is intentionally not part of this
phase; a later workflow must approve the immutable manifest before applying
bounded chunks.

`create_cleanup_plan` accepts an action and 1-50 explicit opaque ids from one
folder. Move and copy plans require a destination. It returns an immutable plan
id plus a one-time confirmation token; the server stores only the token hash.
Plans expire after 15 minutes.

`apply_cleanup_plan` requires the plan id and confirmation token. It claims the
plan before executing it, so a plan cannot be applied twice. If the process
cannot determine the outcome after a claim, the plan is marked `needs_review`
and is not retried automatically.

`cleanup_history` returns compact completed-operation metadata. For archive,
trash, and move operations, the service records destination opaque ids only
when Bridge supplies a complete UIDPLUS mapping. `undo_cleanup_operation` moves
only those exact destination ids back to their recorded source folder. Copy,
flag changes, and unmapped moves are intentionally not undoable.

## Manual automation rules

`create_automation_rule` stores a disabled-by-default rule. It requires a folder
and at least one additional metadata criterion (`from`, `to`, `subject`, date,
seen state, or attachment state). Supported actions are read, unread, archive,
trash, and move; only move requires a destination.

`prepare_automation_run` manually evaluates one enabled rule against at most 50
messages, returns candidate metadata, and creates a standard one-time cleanup
plan when matches exist. It never changes mail itself. `automation_history`
returns no-match, pending-confirmation, applied, and needs-review run records.
There is no schedule, background execution, full-body matching, or permanent
deletion.

`update_automation_rule` replaces a disabled rule. `delete_automation_rule`
requires a disabled rule, cancels any unused confirmation plan it created, and
keeps its run history as a cancelled audit record.

`set_automation_rule_schedule` sets a 15-minute to 7-day interval on a disabled
rule. The HTTP service evaluates due enabled rules once per minute and records
at most 50 opaque ids as a `pending_review` run. Scheduled execution never
creates a confirmation token, applies a plan, or changes mail.

`mark_read`, `mark_unread`, `archive_messages`, and `trash_messages` accept:

```json
{
  "ids": ["opaque-message-id"],
  "dryRun": true
}
```

`move_messages` and `copy_messages` additionally require a destination folder or
label path. Archive and trash resolve Proton's special-use folders through
Bridge. All operations return the action, requested count, affected count, and
source folders. Permanent deletion, arbitrary IMAP commands, and query-based
mutation are out of scope.
