# v0.1 Tool Specification

This document defines the public MCP contract for the first release. Implementation changes must preserve these semantics unless the spec is explicitly changed first.

## General rules

- `v0.1` is read-only.
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

## Future write contract

`v0.2` may add reversible operations such as archive, move, trash, and read/unread. Those tools are intentionally not part of this contract yet.
