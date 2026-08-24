import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import {
  ProtonMailbox,
  decodeMessageId,
  type CleanupCandidatesInput,
  type MailboxAnalysisInput,
  type MailboxInventoryInput,
  type MessageActionInput,
  type MoveMessagesInput,
  type ReceiptCandidatesInput,
  type SearchMailInput,
  type TopSendersInput,
} from "./mail.js";
import { CleanupStateStore } from "./state.js";

function success(output: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(output) }],
    structuredContent: output,
  };
}

function failure(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Mailbox operation failed";
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

function withoutUndefined<T extends Record<string, unknown>>(
  input: T,
): Partial<T> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const mutationAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const destructiveMutationAnnotations = {
  ...mutationAnnotations,
  destructiveHint: true,
} as const;

const plannedMutationAnnotations = {
  ...destructiveMutationAnnotations,
  idempotentHint: false,
} as const;

const cleanupPlanAnnotations = {
  ...mutationAnnotations,
  idempotentHint: false,
} as const;

const messageActionSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(50),
  dryRun: z.boolean().optional(),
});

const moveMessagesSchema = messageActionSchema.extend({
  destination: z.string().min(1),
});

const cleanupPlanSchema = z.object({
  action: z.enum(["read", "unread", "archive", "trash", "move", "copy"]),
  ids: z.array(z.string().min(1)).min(1).max(50),
  destination: z.string().min(1).optional(),
});

const automationMatchSchema = z.object({
  folder: z.string().min(1),
  from: z.string().min(1).optional(),
  to: z.string().min(1).optional(),
  subject: z.string().min(1).optional(),
  before: z.string().datetime().optional(),
  after: z.string().datetime().optional(),
  seen: z.boolean().optional(),
  hasAttachments: z.boolean().optional(),
});

const automationRuleSchema = z.object({
  name: z.string().min(1).max(120),
  action: z.enum(["read", "unread", "archive", "trash", "move"]),
  destination: z.string().min(1).optional(),
  match: automationMatchSchema,
});

export function createServer(): McpServer {
  const mailbox = new ProtonMailbox();
  const cleanupState = new CleanupStateStore();
  const server = new McpServer(
    {
      name: "proton-mcp",
      version: "0.1.0",
    },
    {
      instructions:
        "Proton Mail access via Proton Mail Bridge. Prefer metadata/search tools before fetching individual message bodies. Message ids are opaque and should be passed unchanged to get_message or explicit bounded write tools. Write tools support dryRun and never permanently delete messages.",
    },
  );

  server.registerTool(
    "list_folders",
    {
      title: "List Proton Mail folders",
      description:
        "List folders and labels visible through Proton Mail Bridge.",
      inputSchema: z.object({}),
      annotations: readOnlyAnnotations,
    },
    async () => {
      try {
        return success(await mailbox.listFolders());
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "mailbox_stats",
    {
      title: "Get Proton mailbox statistics",
      description:
        "Return message and unread counts. If folder is omitted, return compact per-folder counts and use All Mail (or Inbox as fallback) for the overall total.",
      inputSchema: z.object({
        folder: z.string().min(1).optional(),
      }),
      annotations: readOnlyAnnotations,
    },
    async ({ folder }) => {
      try {
        return success(await mailbox.mailboxStats(folder));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "top_senders",
    {
      title: "Find top Proton Mail senders",
      description:
        "Aggregate sender counts from a bounded set of messages. Defaults to Inbox and never returns message bodies.",
      inputSchema: z.object({
        folder: z.string().min(1).optional(),
        before: z.string().datetime().optional(),
        after: z.string().datetime().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      annotations: readOnlyAnnotations,
    },
    async (input) => {
      try {
        const request = withoutUndefined(input) as TopSendersInput;
        return success(await mailbox.topSenders(request));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "mailbox_inventory",
    {
      title: "Inventory Proton Mail metadata",
      description:
        "Build a bounded read-only mailbox inventory from message metadata. Returns exact match count plus sampled sender, domain, date, unread, attachment, and size aggregates; never returns message bodies.",
      inputSchema: z.object({
        folder: z.string().min(1).optional(),
        before: z.string().datetime().optional(),
        after: z.string().datetime().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        scanLimit: z.number().int().min(1).max(5000).optional(),
      }),
      annotations: readOnlyAnnotations,
    },
    async (input) => {
      try {
        const request = withoutUndefined(input) as MailboxInventoryInput;
        return success(await mailbox.mailboxInventory(request));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "search_mail",
    {
      title: "Search Proton Mail",
      description:
        "Search one Proton Mail folder using bounded IMAP filters and return metadata summaries only. Defaults to Inbox.",
      inputSchema: z.object({
        folder: z.string().min(1).optional(),
        from: z.string().min(1).optional(),
        to: z.string().min(1).optional(),
        subject: z.string().min(1).optional(),
        text: z.string().min(1).optional(),
        before: z.string().datetime().optional(),
        after: z.string().datetime().optional(),
        seen: z.boolean().optional(),
        hasAttachments: z.boolean().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      annotations: readOnlyAnnotations,
    },
    async (input) => {
      try {
        const request = withoutUndefined(input) as SearchMailInput;
        return success(await mailbox.searchMail(request));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "cleanup_candidates",
    {
      title: "Find Proton Mail cleanup candidates",
      description:
        "Return bounded metadata-only candidates for review before cleanup. Candidates are read messages from frequent senders and optionally older than a requested age; this tool never mutates mail.",
      inputSchema: z.object({
        folder: z.string().min(1).optional(),
        from: z.string().min(1).optional(),
        to: z.string().min(1).optional(),
        subject: z.string().min(1).optional(),
        text: z.string().min(1).optional(),
        before: z.string().datetime().optional(),
        after: z.string().datetime().optional(),
        seen: z.boolean().optional(),
        hasAttachments: z.boolean().optional(),
        olderThanDays: z.number().int().min(1).max(36500).optional(),
        minSenderCount: z.number().int().min(2).max(5000).optional(),
        includeUnread: z.boolean().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        scanLimit: z.number().int().min(1).max(5000).optional(),
      }),
      annotations: readOnlyAnnotations,
    },
    async (input) => {
      try {
        const request = withoutUndefined(input) as CleanupCandidatesInput;
        return success(await mailbox.cleanupCandidates(request));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "mailbox_analysis",
    {
      title: "Analyze Proton Mail metadata",
      description:
        "Build a bounded read-only analysis of attachment types, duplicate candidates, subject-based thread groups, and newsletter headers. Results are heuristics for review and never mutate mail or fetch message bodies.",
      inputSchema: z.object({
        folder: z.string().min(1).optional(),
        from: z.string().min(1).optional(),
        to: z.string().min(1).optional(),
        subject: z.string().min(1).optional(),
        text: z.string().min(1).optional(),
        before: z.string().datetime().optional(),
        after: z.string().datetime().optional(),
        seen: z.boolean().optional(),
        hasAttachments: z.boolean().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      annotations: readOnlyAnnotations,
    },
    async (input) => {
      try {
        const request = withoutUndefined(input) as MailboxAnalysisInput;
        return success(await mailbox.mailboxAnalysis(request));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "get_message",
    {
      title: "Read one Proton Mail message",
      description:
        "Fetch one message by the opaque id returned by search_mail. Returns text/HTML bodies with bounded size and attachment metadata only.",
      inputSchema: z.object({
        id: z.string().min(1),
      }),
      annotations: readOnlyAnnotations,
    },
    async ({ id }) => {
      try {
        return success(await mailbox.getMessage(id));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "extract_receipt",
    {
      title: "Extract receipt or purchase details",
      description:
        "Inspect one explicitly selected message using bounded text/HTML retrieval and extract receipt signals, merchant, order reference, and currency amounts. This is a heuristic and never changes mail.",
      inputSchema: z.object({
        id: z.string().min(1),
      }),
      annotations: readOnlyAnnotations,
    },
    async ({ id }) => {
      try {
        return success(await mailbox.extractReceipt(id));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "receipt_candidates",
    {
      title: "Find likely purchase receipts",
      description:
        "Find bounded, metadata-only likely receipts using subject-line signals. Review candidates with extract_receipt before taking action; message bodies are not fetched.",
      inputSchema: z.object({
        folder: z.string().min(1).optional(),
        before: z.string().datetime().optional(),
        after: z.string().datetime().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        scanLimit: z.number().int().min(1).max(500).optional(),
      }),
      annotations: readOnlyAnnotations,
    },
    async (input) => {
      try {
        return success(
          await mailbox.receiptCandidates(
            withoutUndefined(input) as ReceiptCandidatesInput,
          ),
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "create_automation_rule",
    {
      title: "Create a manual mailbox automation rule",
      description:
        "Store a disabled-by-default rule with bounded metadata filters. Rules never run in the background; use prepare_automation_run to evaluate one manually.",
      inputSchema: automationRuleSchema,
      annotations: cleanupPlanAnnotations,
    },
    async ({ name, action, destination, match }) => {
      try {
        if ((action === "move") !== Boolean(destination?.trim())) {
          throw new Error("destination is required only for move rules");
        }
        if (
          match.from === undefined &&
          match.to === undefined &&
          match.subject === undefined &&
          match.before === undefined &&
          match.after === undefined &&
          match.seen === undefined &&
          match.hasAttachments === undefined
        ) {
          throw new Error(
            "automation rules require at least one match criterion",
          );
        }
        return success({
          rule: await cleanupState.createRule({
            name: name.trim(),
            action,
            enabled: false,
            ...(destination ? { destination: destination.trim() } : {}),
            match: {
              folder: match.folder,
              ...(match.from ? { from: match.from } : {}),
              ...(match.to ? { to: match.to } : {}),
              ...(match.subject ? { subject: match.subject } : {}),
              ...(match.before ? { before: match.before } : {}),
              ...(match.after ? { after: match.after } : {}),
              ...(match.seen !== undefined ? { seen: match.seen } : {}),
              ...(match.hasAttachments !== undefined
                ? { hasAttachments: match.hasAttachments }
                : {}),
            },
          }),
        });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "list_automation_rules",
    {
      title: "List manual mailbox automation rules",
      description:
        "List persisted automation rules and whether they are enabled. This tool does not inspect or change mail.",
      inputSchema: z.object({}),
      annotations: readOnlyAnnotations,
    },
    async () => {
      try {
        return success({ rules: await cleanupState.listRules() });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "set_automation_rule_enabled",
    {
      title: "Enable or disable a manual automation rule",
      description:
        "Enable or disable a stored rule. Enabling does not schedule it or change mail.",
      inputSchema: z.object({
        ruleId: z.string().uuid(),
        enabled: z.boolean(),
      }),
      annotations: cleanupPlanAnnotations,
    },
    async ({ ruleId, enabled }) => {
      try {
        return success({
          rule: await cleanupState.setRuleEnabled(ruleId, enabled),
        });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "prepare_automation_run",
    {
      title: "Evaluate a rule and prepare a confirmed run",
      description:
        "Manually evaluate one enabled rule against up to 50 messages. Returns metadata candidates and, when matches exist, the same 15-minute one-time cleanup plan used for manual batches. It does not change mail.",
      inputSchema: z.object({
        ruleId: z.string().uuid(),
        limit: z.number().int().min(1).max(50).optional(),
      }),
      annotations: cleanupPlanAnnotations,
    },
    async ({ ruleId, limit }) => {
      try {
        const rule = await cleanupState.getRule(ruleId);
        const result = await mailbox.searchMail({
          ...rule.match,
          limit: limit ?? 50,
        });
        const prepared = await cleanupState.createRuleRun(
          rule.id,
          result.messages.map((message) => message.id),
          rule.match.folder,
        );
        return success({
          rule,
          candidates: result.messages,
          truncated: result.truncated,
          scanned: result.scanned,
          ...prepared,
        });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "automation_history",
    {
      title: "List manual automation run history",
      description:
        "List bounded rule evaluation and confirmation-run history without returning message bodies.",
      inputSchema: z.object({
        ruleId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      annotations: readOnlyAnnotations,
    },
    async ({ ruleId, limit }) => {
      try {
        return success({
          runs: await cleanupState.listRuleRuns(ruleId, limit),
        });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "create_cleanup_plan",
    {
      title: "Create a reviewable cleanup plan",
      description:
        "Create a 15-minute, one-time confirmation plan for up to 50 explicit message ids from one folder. The plan does not change mail.",
      inputSchema: cleanupPlanSchema,
      annotations: cleanupPlanAnnotations,
    },
    async ({ action, ids, destination }) => {
      try {
        if ((action === "move" || action === "copy") && !destination?.trim()) {
          throw new Error("destination is required for move and copy plans");
        }
        if (
          (action === "read" ||
            action === "unread" ||
            action === "archive" ||
            action === "trash") &&
          destination
        ) {
          throw new Error("destination is only valid for move and copy plans");
        }
        const refs = ids.map(decodeMessageId);
        const folders = [...new Set(refs.map((ref) => ref.folder))];
        if (folders.length !== 1)
          throw new Error("all ids in one plan must belong to the same folder");
        return success(
          await cleanupState.createPlan({
            action,
            ids,
            sourceFolder: folders[0]!,
            ...(destination ? { destination: destination.trim() } : {}),
          }),
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "apply_cleanup_plan",
    {
      title: "Apply a confirmed cleanup plan",
      description:
        "Apply exactly one unexpired cleanup plan using its confirmation token. The plan cannot be reused.",
      inputSchema: z.object({
        planId: z.string().uuid(),
        confirmationToken: z.string().min(1),
      }),
      annotations: plannedMutationAnnotations,
    },
    async ({ planId, confirmationToken }) => {
      try {
        const plan = await cleanupState.claimPlan(planId, confirmationToken);
        const input = { ids: plan.ids };
        let result;
        try {
          result =
            plan.action === "read"
              ? await mailbox.markRead(input)
              : plan.action === "unread"
                ? await mailbox.markUnread(input)
                : plan.action === "archive"
                  ? await mailbox.archiveMessages(input)
                  : plan.action === "trash"
                    ? await mailbox.trashMessages(input)
                    : plan.action === "move"
                      ? await mailbox.moveMessages({
                          ...input,
                          destination: plan.destination!,
                        })
                      : await mailbox.copyMessages({
                          ...input,
                          destination: plan.destination!,
                        });
          const operation = await cleanupState.completePlan(plan.id, {
            action: plan.action,
            sourceFolder: plan.sourceFolder,
            ...(result.destination ? { destination: result.destination } : {}),
            ...(result.undo
              ? {
                  undo: {
                    sourceFolder: result.undo.sourceFolder,
                    destinationIds: result.undo.destinationIds,
                  },
                }
              : {}),
          });
          return success({ planId: plan.id, operation, ...result });
        } catch (error) {
          await cleanupState.flagPlanForReview(plan.id);
          throw error;
        }
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "cleanup_history",
    {
      title: "List cleanup operation history",
      description:
        "List recent confirmed cleanup operations and whether they have an exact undo record. Message bodies are never stored or returned.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).optional(),
      }),
      annotations: readOnlyAnnotations,
    },
    async ({ limit }) => {
      try {
        return success({
          operations: await cleanupState.listOperations(limit),
        });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "undo_cleanup_operation",
    {
      title: "Undo an exact cleanup operation",
      description:
        "Undo one completed archive, trash, or move operation only when Bridge supplied exact destination UID mappings. The operation cannot be retried after an uncertain failure.",
      inputSchema: z.object({ operationId: z.string().uuid() }),
      annotations: plannedMutationAnnotations,
    },
    async ({ operationId }) => {
      try {
        const operation = await cleanupState.claimUndo(operationId);
        try {
          await mailbox.moveMessages({
            ids: operation.undo!.destinationIds,
            destination: operation.undo!.sourceFolder,
          });
          await cleanupState.completeUndo(operation.id);
          return success({ operationId: operation.id, status: "undone" });
        } catch (error) {
          await cleanupState.flagOperationForReview(operation.id);
          throw error;
        }
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "mark_read",
    {
      title: "Mark Proton Mail messages read",
      description:
        "Mark up to 50 messages read using opaque ids returned by search_mail. Use dryRun to inspect the intended operation without changing mail.",
      inputSchema: messageActionSchema,
      annotations: mutationAnnotations,
    },
    async (input) => {
      try {
        return success(await mailbox.markRead(input as MessageActionInput));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "mark_unread",
    {
      title: "Mark Proton Mail messages unread",
      description:
        "Mark up to 50 messages unread using opaque ids returned by search_mail. Use dryRun to inspect the intended operation without changing mail.",
      inputSchema: messageActionSchema,
      annotations: mutationAnnotations,
    },
    async (input) => {
      try {
        return success(await mailbox.markUnread(input as MessageActionInput));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "archive_messages",
    {
      title: "Archive Proton Mail messages",
      description:
        "Move up to 50 messages to Proton's Archive folder using opaque ids returned by search_mail. Supports dryRun and never permanently deletes mail.",
      inputSchema: messageActionSchema,
      annotations: mutationAnnotations,
    },
    async (input) => {
      try {
        return success(
          await mailbox.archiveMessages(input as MessageActionInput),
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "trash_messages",
    {
      title: "Move Proton Mail messages to Trash",
      description:
        "Move up to 50 messages to Proton's Trash folder using opaque ids returned by search_mail. Supports dryRun; permanent deletion is not exposed.",
      inputSchema: messageActionSchema,
      annotations: destructiveMutationAnnotations,
    },
    async (input) => {
      try {
        return success(
          await mailbox.trashMessages(input as MessageActionInput),
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "move_messages",
    {
      title: "Move Proton Mail messages",
      description:
        "Move up to 50 messages to an explicit Proton Mail folder or label using opaque ids returned by search_mail. Supports dryRun.",
      inputSchema: moveMessagesSchema,
      annotations: mutationAnnotations,
    },
    async (input) => {
      try {
        return success(await mailbox.moveMessages(input as MoveMessagesInput));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "copy_messages",
    {
      title: "Copy Proton Mail messages",
      description:
        "Copy up to 50 messages to an explicit Proton Mail folder or label using opaque ids returned by search_mail. Supports dryRun.",
      inputSchema: moveMessagesSchema,
      annotations: mutationAnnotations,
    },
    async (input) => {
      try {
        return success(await mailbox.copyMessages(input as MoveMessagesInput));
      } catch (error) {
        return failure(error);
      }
    },
  );

  return server;
}
