import { readFile } from "node:fs/promises";

import {
  ImapFlow,
  type CopyResponseObject,
  type FetchMessageObject,
  type ImapFlowOptions,
  type MessageAddressObject,
  type MessageStructureObject,
  type SearchObject,
} from "imapflow";

const DEFAULT_PASSWORD_FILE = "/run/secrets/bridge_imap_password";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 1143;
const DEFAULT_SECURITY = "STARTTLS";
const DEFAULT_RESULT_LIMIT = 20;
const MAX_RESULT_LIMIT = 100;
const MAX_SEARCH_SCAN = 1000;
const MAX_SENDER_SCAN = 5000;
const MAX_INVENTORY_SCAN = 5000;
const MAX_BODY_BYTES = 256 * 1024;
const MAX_MUTATION_BATCH = 50;
export const MAX_BULK_SCAN = 12_000;

export function parseBulkScanLimit(value: number | undefined): number {
  const scanLimit = value ?? MAX_BULK_SCAN;
  if (
    !Number.isInteger(scanLimit) ||
    scanLimit < 1 ||
    scanLimit > MAX_BULK_SCAN
  ) {
    throw new Error(`scanLimit must be between 1 and ${MAX_BULK_SCAN}`);
  }
  return scanLimit;
}
const MAX_ANALYSIS_SCAN = 500;

export type ImapSecurity = "STARTTLS" | "SSL" | "NONE";

export interface ImapConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  security: ImapSecurity;
  tlsRejectUnauthorized: boolean;
}

export type AddressSummary = {
  name: string | null;
  address: string | null;
};

export type MessageSummary = {
  id: string;
  folder: string;
  from: AddressSummary;
  subject: string | null;
  receivedAt: string | null;
  size: number;
  seen: boolean;
  hasAttachments: boolean;
};

export type SearchMailInput = {
  folder?: string;
  from?: string;
  to?: string;
  subject?: string;
  text?: string;
  before?: string;
  after?: string;
  seen?: boolean;
  hasAttachments?: boolean;
  limit?: number;
};

export type TopSendersInput = {
  folder?: string;
  before?: string;
  after?: string;
  limit?: number;
};

export type MailboxInventoryInput = TopSendersInput & {
  scanLimit?: number;
};

export type CleanupCandidatesInput = SearchMailInput & {
  olderThanDays?: number;
  minSenderCount?: number;
  includeUnread?: boolean;
  scanLimit?: number;
};

export type BulkSearchInput = SearchMailInput & {
  scanLimit?: number;
  excludeFrom?: string[];
  excludeDomains?: string[];
  excludeSubjectTerms?: string[];
};

export type MailboxAnalysisInput = SearchMailInput & {
  scanLimit?: number;
};

export type ReceiptCandidatesInput = {
  folder?: string;
  before?: string;
  after?: string;
  limit?: number;
  scanLimit?: number;
};

export type MessageActionInput = {
  ids: string[];
  dryRun?: boolean;
};

export type MoveMessagesInput = MessageActionInput & {
  destination: string;
};

export type MutationResult = {
  action: string;
  dryRun: boolean;
  requested: number;
  affected: number;
  folders: string[];
  destination?: string;
  undo?: {
    sourceFolder: string;
    destination: string;
    destinationIds: string[];
  };
};

type MessageRef = {
  v: 1;
  folder: string;
  uid: number;
  uidValidity: string;
};

type BodyPart = {
  part: string;
  node: MessageStructureObject;
};

type DownloadedText = {
  text: string;
  truncated: boolean;
};

function envBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  if (value === "1" || value.toLowerCase() === "true") return true;
  if (value === "0" || value.toLowerCase() === "false") return false;
  throw new Error(`Invalid boolean value: ${value}`);
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return (
    normalized === "127.0.0.1" ||
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
}

function parseSecurity(value: string): ImapSecurity {
  const normalized = value.trim().toUpperCase();
  if (
    normalized === "STARTTLS" ||
    normalized === "SSL" ||
    normalized === "NONE"
  ) {
    return normalized;
  }
  throw new Error(
    `Invalid BRIDGE_IMAP_SECURITY: ${value}. Use STARTTLS, SSL, or NONE.`,
  );
}

function parsePort(value: string | undefined): number {
  const port = Number(value ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `Invalid BRIDGE_IMAP_PORT: ${value ?? String(DEFAULT_PORT)}`,
    );
  }
  return port;
}

function parseDate(value: string, field: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${field} date`);
  }
  return date;
}

function boundedLimit(
  value: number | undefined,
  fallback = DEFAULT_RESULT_LIMIT,
): number {
  const limit = value ?? fallback;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RESULT_LIMIT) {
    throw new Error(`limit must be between 1 and ${MAX_RESULT_LIMIT}`);
  }
  return limit;
}

function messageIds(value: string[]): MessageRef[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > MAX_MUTATION_BATCH
  ) {
    throw new Error(
      `ids must contain between 1 and ${MAX_MUTATION_BATCH} message ids`,
    );
  }
  const unique = [...new Set(value)];
  if (unique.length !== value.length) throw new Error("ids must be unique");
  return unique.map(decodeMessageId);
}

export function parseInventoryScanLimit(value: number | undefined): number {
  const limit = value ?? MAX_INVENTORY_SCAN;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_INVENTORY_SCAN) {
    throw new Error(`scanLimit must be between 1 and ${MAX_INVENTORY_SCAN}`);
  }
  return limit;
}

function parseDays(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 1 || value > 36500) {
    throw new Error("olderThanDays must be between 1 and 36500");
  }
  return value;
}

function parseSenderThreshold(value: number | undefined): number {
  const threshold = value ?? 10;
  if (!Number.isInteger(threshold) || threshold < 2 || threshold > 5000) {
    throw new Error("minSenderCount must be between 2 and 5000");
  }
  return threshold;
}

function normalizeSubject(subject: string | null): string {
  return (subject ?? "")
    .replace(/^(re|fw|fwd):\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function headerValue(headers: Buffer | undefined, name: string): string | null {
  if (!headers) return null;
  const pattern = new RegExp(`^${name}:\\s*(.+)$`, "im");
  return headers.toString("utf8").match(pattern)?.[1]?.trim() ?? null;
}

export function extractReceiptDetails(input: {
  from: AddressSummary[];
  subject: string | null;
  receivedAt: string | null;
  text: string | null;
  html: string | null;
  bodyTruncated: boolean;
}): {
  isReceipt: boolean;
  confidence: "low" | "medium" | "high";
  merchant: string | null;
  orderNumber: string | null;
  amounts: Array<{ value: string; currency: string | null }>;
  receivedAt: string | null;
  bodyTruncated: boolean;
  signals: string[];
} {
  const body =
    `${input.subject ?? ""}\n${input.text ?? ""}\n${input.html ?? ""}`
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ");
  const signals: string[] = [];
  if (
    /\b(receipt|invoice|order confirmation|payment confirmation|purchase)\b/i.test(
      body,
    )
  ) {
    signals.push("receipt-keyword");
  }
  const order = body.match(
    /\b(?:order|invoice|receipt)\s*(?:number|no\.?|id|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{3,})\b/i,
  );
  if (order) signals.push("order-reference");
  const amounts = [
    ...body.matchAll(
      /(?:([€$£])\s*([0-9]+(?:[.,][0-9]{2})?)|(EUR|USD|GBP)\s*([0-9]+(?:[.,][0-9]{2})?)|([0-9]+(?:[.,][0-9]{2})?)\s*(EUR|USD|GBP))/gi,
    ),
  ]
    .slice(0, 10)
    .map((match) => ({
      value: match[2] ?? match[4] ?? match[5] ?? "",
      currency:
        match[1] === "€"
          ? "EUR"
          : match[1] === "$"
            ? "USD"
            : match[1] === "£"
              ? "GBP"
              : (match[3]?.toUpperCase() ?? match[6]?.toUpperCase() ?? null),
    }));
  if (amounts.length) signals.push("currency-amount");
  const confidence =
    signals.length >= 3 ? "high" : signals.length >= 2 ? "medium" : "low";
  return {
    isReceipt: signals.length >= 2,
    confidence,
    merchant: input.from[0]?.name ?? input.from[0]?.address ?? null,
    orderNumber: order?.[1] ?? null,
    amounts,
    receivedAt: input.receivedAt,
    bodyTruncated: input.bodyTruncated,
    signals,
  };
}

export async function loadImapConfig(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ImapConfig> {
  const host = (env.BRIDGE_IMAP_HOST ?? DEFAULT_HOST).trim();
  if (!isLoopbackHost(host)) {
    throw new Error(
      "BRIDGE_IMAP_HOST must be loopback; proton-mcp is designed to share the Bridge network namespace",
    );
  }

  const username = env.BRIDGE_IMAP_USERNAME?.trim();
  if (!username) {
    throw new Error("BRIDGE_IMAP_USERNAME is required");
  }

  const passwordFile = env.BRIDGE_IMAP_PASSWORD_FILE ?? DEFAULT_PASSWORD_FILE;
  const password = (await readFile(passwordFile, "utf8")).trim();
  if (!password) {
    throw new Error("Bridge IMAP password secret is empty");
  }

  return {
    host,
    port: parsePort(env.BRIDGE_IMAP_PORT),
    username,
    password,
    security: parseSecurity(env.BRIDGE_IMAP_SECURITY ?? DEFAULT_SECURITY),
    tlsRejectUnauthorized: envBoolean(
      env.BRIDGE_IMAP_TLS_REJECT_UNAUTHORIZED,
      false,
    ),
  };
}

function createImapClient(config: ImapConfig): ImapFlow {
  const options: ImapFlowOptions = {
    host: config.host,
    port: config.port,
    secure: config.security === "SSL",
    auth: {
      user: config.username,
      pass: config.password,
    },
    tls: {
      rejectUnauthorized: config.tlsRejectUnauthorized,
    },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    maxLiteralSize: MAX_BODY_BYTES * 4,
    maxResponseSize: MAX_BODY_BYTES * 8,
    clientInfo: {
      name: "proton-mcp",
      version: "0.1.0",
    },
  };

  if (config.security === "STARTTLS") options.doSTARTTLS = true;
  if (config.security === "NONE") options.doSTARTTLS = false;

  return new ImapFlow(options);
}

async function withClient<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  const config = await loadImapConfig();
  const client = createImapClient(config);
  let connected = false;

  try {
    await client.connect();
    connected = true;
    return await fn(client);
  } finally {
    if (connected && client.usable) {
      try {
        await client.logout();
      } catch {
        client.close();
      }
    } else {
      client.close();
    }
  }
}

export function encodeMessageId(ref: MessageRef): string {
  return Buffer.from(JSON.stringify(ref), "utf8").toString("base64url");
}

export function decodeMessageId(id: string): MessageRef {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(id, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid message id");
  }

  if (
    typeof value !== "object" ||
    value === null ||
    !("v" in value) ||
    value.v !== 1 ||
    !("folder" in value) ||
    typeof value.folder !== "string" ||
    !("uid" in value) ||
    typeof value.uid !== "number" ||
    !Number.isInteger(value.uid) ||
    value.uid < 1 ||
    !("uidValidity" in value) ||
    typeof value.uidValidity !== "string"
  ) {
    throw new Error("Invalid message id");
  }

  return {
    v: 1,
    folder: value.folder,
    uid: value.uid,
    uidValidity: value.uidValidity,
  };
}

function normalizeSpecialUse(value: string | undefined): string | null {
  if (!value) return null;
  return value.replace(/^\\/, "").toLowerCase();
}

function firstAddress(
  addresses: MessageAddressObject[] | undefined,
): AddressSummary {
  const address = addresses?.[0];
  return {
    name: address?.name ?? null,
    address: address?.address ?? null,
  };
}

function allAddresses(
  addresses: MessageAddressObject[] | undefined,
): AddressSummary[] {
  return (addresses ?? []).map((address) => ({
    name: address.name ?? null,
    address: address.address ?? null,
  }));
}

function walkStructure(
  node: MessageStructureObject | undefined,
  fn: (node: MessageStructureObject) => void,
): void {
  if (!node) return;
  fn(node);
  for (const child of node.childNodes ?? []) walkStructure(child, fn);
}

export function findAttachments(
  structure: MessageStructureObject | undefined,
): Array<{
  filename: string | null;
  contentType: string;
  size: number;
}> {
  const attachments: Array<{
    filename: string | null;
    contentType: string;
    size: number;
  }> = [];

  walkStructure(structure, (node) => {
    const disposition = node.disposition?.toLowerCase();
    const filename =
      node.dispositionParameters?.filename ?? node.parameters?.name ?? null;
    const topType = node.type.toLowerCase().split("/")[0];
    const isAttachment =
      disposition === "attachment" ||
      filename !== null ||
      (topType !== "text" && topType !== "multipart" && !disposition);

    if (isAttachment) {
      attachments.push({
        filename,
        contentType: node.type,
        size: node.size ?? 0,
      });
    }
  });

  return attachments;
}

function findBodyPart(
  structure: MessageStructureObject | undefined,
  contentType: "text/plain" | "text/html",
): BodyPart | null {
  let found: BodyPart | null = null;
  walkStructure(structure, (node) => {
    if (found || !node.part) return;
    if (node.disposition?.toLowerCase() === "attachment") return;
    if (node.type.toLowerCase() === contentType) {
      found = { part: node.part, node };
    }
  });
  return found;
}

function messageDate(message: FetchMessageObject): string | null {
  const value = message.internalDate ?? message.envelope?.date;
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function summarizeMessage(
  folder: string,
  uidValidity: bigint,
  message: FetchMessageObject,
): MessageSummary {
  return {
    id: encodeMessageId({
      v: 1,
      folder,
      uid: message.uid,
      uidValidity: uidValidity.toString(),
    }),
    folder,
    from: firstAddress(message.envelope?.from),
    subject: message.envelope?.subject ?? null,
    receivedAt: messageDate(message),
    size: message.size ?? 0,
    seen: message.flags?.has("\\Seen") ?? false,
    hasAttachments: findAttachments(message.bodyStructure).length > 0,
  };
}

function buildSearchQuery(
  input: SearchMailInput | TopSendersInput | MailboxInventoryInput,
): SearchObject {
  const query: SearchObject = {};
  if ("from" in input && input.from) query.from = input.from;
  if ("to" in input && input.to) query.to = input.to;
  if ("subject" in input && input.subject) query.subject = input.subject;
  if ("text" in input && input.text) query.text = input.text;
  if (input.before) query.before = parseDate(input.before, "before");
  if (input.after) query.since = parseDate(input.after, "after");
  if ("seen" in input && input.seen !== undefined) query.seen = input.seen;
  return Object.keys(query).length === 0 ? { all: true } : query;
}

async function fetchSummaries(
  client: ImapFlow,
  folder: string,
  uids: number[],
): Promise<MessageSummary[]> {
  if (uids.length === 0) return [];
  const mailbox = client.mailbox;
  if (!mailbox) throw new Error("Mailbox was not opened");

  const messages = await client.fetchAll(
    uids,
    {
      envelope: true,
      flags: true,
      internalDate: true,
      size: true,
      bodyStructure: true,
    },
    { uid: true },
  );

  return messages
    .map((message) => summarizeMessage(folder, mailbox.uidValidity, message))
    .sort((a, b) => (b.receivedAt ?? "").localeCompare(a.receivedAt ?? ""));
}

function selectable(flags: Set<string>): boolean {
  return !flags.has("\\Noselect");
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function decodeText(buffer: Buffer, charset: string | undefined): string {
  const encoding = charset?.trim() || "utf-8";
  try {
    return new TextDecoder(encoding).decode(buffer);
  } catch {
    return new TextDecoder("utf-8").decode(buffer);
  }
}

async function downloadTextPart(
  client: ImapFlow,
  uid: number,
  bodyPart: BodyPart | null,
): Promise<DownloadedText | null> {
  if (!bodyPart) return null;
  const downloaded = await client.download(uid, bodyPart.part, {
    uid: true,
    maxBytes: MAX_BODY_BYTES,
  });
  const buffer = await streamToBuffer(downloaded.content);
  return {
    text: decodeText(
      buffer,
      downloaded.meta.charset ?? bodyPart.node.parameters?.charset,
    ),
    truncated: downloaded.meta.expectedSize > buffer.length,
  };
}

export class ProtonMailbox {
  async searchBulk(input: BulkSearchInput): Promise<{
    messages: MessageSummary[];
    scanned: number;
    truncated: boolean;
  }> {
    const folder = input.folder ?? "INBOX";
    const scanLimit = parseBulkScanLimit(input.scanLimit);

    return withClient(async (client) => {
      const lock = await client.getMailboxLock(folder, {
        readOnly: true,
        acquireTimeout: 10_000,
      });
      try {
        const found = await client.search(buildSearchQuery(input), {
          uid: true,
        });
        const uids = Array.isArray(found) ? found : [];
        const candidates = uids.slice(-scanLimit);
        const summaries = await fetchSummaries(client, folder, candidates);
        const excludedSenders = new Set(
          (input.excludeFrom ?? []).map((value) => value.toLowerCase()),
        );
        const excludedDomains = (input.excludeDomains ?? []).map((value) =>
          value.toLowerCase(),
        );
        const excludedSubjectTerms = (input.excludeSubjectTerms ?? []).map(
          (value) => value.toLowerCase(),
        );
        const messages = summaries.filter((message) => {
          const address = message.from.address?.toLowerCase() ?? "";
          const subject = message.subject?.toLowerCase() ?? "";
          if (excludedSenders.has(address)) return false;
          if (
            excludedDomains.some(
              (domain) => address === domain || address.endsWith(`@${domain}`),
            )
          )
            return false;
          if (excludedSubjectTerms.some((term) => subject.includes(term)))
            return false;
          return true;
        });
        return {
          messages,
          scanned: candidates.length,
          truncated: uids.length > candidates.length,
        };
      } finally {
        lock.release();
      }
    });
  }

  private async mutateMessages(
    ids: string[],
    dryRun: boolean | undefined,
    action: "read" | "unread" | "archive" | "trash" | "move" | "copy",
    destination?: string,
  ): Promise<MutationResult> {
    const refs = messageIds(ids);
    const planned: MutationResult = {
      action,
      dryRun: dryRun === true,
      requested: refs.length,
      affected: 0,
      folders: [...new Set(refs.map((ref) => ref.folder))],
      ...(destination ? { destination } : {}),
    };
    if (planned.folders.length > 1) {
      throw new Error(
        "all ids in one operation must belong to the same folder",
      );
    }
    if (dryRun) return planned;

    return withClient(async (client) => {
      const groups = new Map<string, MessageRef[]>();
      for (const ref of refs) {
        const group = groups.get(ref.folder) ?? [];
        group.push(ref);
        groups.set(ref.folder, group);
      }

      for (const [folder, folderRefs] of groups) {
        const lock = await client.getMailboxLock(folder, {
          readOnly: false,
          acquireTimeout: 10_000,
        });
        try {
          const mailbox = client.mailbox;
          if (!mailbox) throw new Error("Mailbox was not opened");
          for (const ref of folderRefs) {
            if (mailbox.uidValidity.toString() !== ref.uidValidity) {
              throw new Error(
                `Message id is stale because mailbox UIDVALIDITY changed for ${folder}`,
              );
            }
          }

          const uids = folderRefs.map((ref) => ref.uid);
          const existing = await client.fetchAll(
            uids,
            { uid: true },
            { uid: true },
          );
          if (existing.length !== uids.length) {
            throw new Error("one or more message ids no longer exist");
          }
          let result: boolean;
          let copied: CopyResponseObject | false = false;
          let resolvedDestination = destination;
          if (action === "read") {
            result = await client.messageFlagsAdd(uids, ["\\Seen"], {
              uid: true,
            });
          } else if (action === "unread") {
            result = await client.messageFlagsRemove(uids, ["\\Seen"], {
              uid: true,
            });
          } else if (action === "move") {
            if (!destination) throw new Error("destination is required");
            copied = await client.messageMove(uids, destination, { uid: true });
            result = Boolean(copied);
          } else if (action === "copy") {
            if (!destination) throw new Error("destination is required");
            copied = await client.messageCopy(uids, destination, { uid: true });
            result = Boolean(copied);
          } else {
            const target =
              destination ?? (await this.specialFolder(client, action));
            resolvedDestination = target;
            copied = await client.messageMove(uids, target, { uid: true });
            result = Boolean(copied);
          }
          if (!result) throw new Error(`IMAP operation failed for ${folder}`);
          planned.affected += folderRefs.length;
          if (
            resolvedDestination &&
            action !== "copy" &&
            copied &&
            copied.uidMap
          ) {
            const destinationIds = folderRefs
              .map((ref) => {
                const destinationUid = copied.uidMap?.get(ref.uid);
                if (!destinationUid || !copied.uidValidity) return null;
                return encodeMessageId({
                  v: 1,
                  folder: resolvedDestination,
                  uid: destinationUid,
                  uidValidity: copied.uidValidity.toString(),
                });
              })
              .filter((id): id is string => id !== null);
            if (destinationIds.length === folderRefs.length) {
              planned.destination = resolvedDestination;
              planned.undo = {
                sourceFolder: folder,
                destination: resolvedDestination,
                destinationIds,
              };
            }
          }
        } finally {
          lock.release();
        }
      }
      return planned;
    });
  }

  private async specialFolder(
    client: ImapFlow,
    action: "archive" | "trash",
  ): Promise<string> {
    const wanted = action === "archive" ? "\\Archive" : "\\Trash";
    const folders = await client.list();
    const match = folders.find((folder) => folder.specialUse === wanted);
    if (!match)
      throw new Error(`No ${action} folder is exposed by Proton Mail Bridge`);
    return match.path;
  }

  async listFolders(): Promise<{
    folders: Array<{
      name: string;
      path: string;
      specialUse: string | null;
      selectable: boolean;
    }>;
  }> {
    return withClient(async (client) => {
      const folders = await client.list();
      return {
        folders: folders.map((folder) => ({
          name: folder.name,
          path: folder.path,
          specialUse: normalizeSpecialUse(folder.specialUse),
          selectable: selectable(folder.flags),
        })),
      };
    });
  }

  async mailboxStats(folder?: string): Promise<{
    total: number;
    unread: number;
    scope: string;
    folders: Array<{ path: string; total: number; unread: number }>;
  }> {
    return withClient(async (client) => {
      if (folder) {
        const status = await client.status(folder, {
          messages: true,
          unseen: true,
        });
        return {
          total: status.messages ?? 0,
          unread: status.unseen ?? 0,
          scope: folder,
          folders: [
            {
              path: folder,
              total: status.messages ?? 0,
              unread: status.unseen ?? 0,
            },
          ],
        };
      }

      const listed = await client.list({
        statusQuery: { messages: true, unseen: true },
      });
      const selectableFolders = listed.filter((item) => selectable(item.flags));
      const folders = selectableFolders.map((item) => ({
        path: item.path,
        total: item.status?.messages ?? 0,
        unread: item.status?.unseen ?? 0,
      }));

      const overall =
        selectableFolders.find((item) => item.specialUse === "\\All") ??
        selectableFolders.find((item) => item.path.toUpperCase() === "INBOX") ??
        selectableFolders[0];

      return {
        total: overall?.status?.messages ?? 0,
        unread: overall?.status?.unseen ?? 0,
        scope: overall?.path ?? "none",
        folders,
      };
    });
  }

  async searchMail(input: SearchMailInput): Promise<{
    messages: MessageSummary[];
    truncated: boolean;
    scanned: number;
  }> {
    const folder = input.folder ?? "INBOX";
    const limit = boundedLimit(input.limit);

    return withClient(async (client) => {
      const lock = await client.getMailboxLock(folder, {
        readOnly: true,
        acquireTimeout: 10_000,
      });
      try {
        const found = await client.search(buildSearchQuery(input), {
          uid: true,
        });
        const uids = Array.isArray(found) ? found : [];
        const attachmentFiltering = input.hasAttachments !== undefined;
        const scanLimit = attachmentFiltering ? MAX_SEARCH_SCAN : limit + 1;
        const candidates = uids.slice(-scanLimit);
        const summaries = await fetchSummaries(client, folder, candidates);
        const filtered =
          input.hasAttachments === undefined
            ? summaries
            : summaries.filter(
                (message) => message.hasAttachments === input.hasAttachments,
              );
        return {
          messages: filtered.slice(0, limit),
          truncated: uids.length > candidates.length || filtered.length > limit,
          scanned: candidates.length,
        };
      } finally {
        lock.release();
      }
    });
  }

  async topSenders(input: TopSendersInput): Promise<{
    senders: Array<{
      name: string | null;
      address: string;
      count: number;
      latestAt: string | null;
    }>;
    scanned: number;
    truncated: boolean;
  }> {
    const folder = input.folder ?? "INBOX";
    const limit = boundedLimit(input.limit, 25);

    return withClient(async (client) => {
      const lock = await client.getMailboxLock(folder, {
        readOnly: true,
        acquireTimeout: 10_000,
      });
      try {
        const found = await client.search(buildSearchQuery(input), {
          uid: true,
        });
        const uids = Array.isArray(found) ? found : [];
        const candidates = uids.slice(-MAX_SENDER_SCAN);
        if (candidates.length === 0) {
          return { senders: [], scanned: 0, truncated: false };
        }

        const messages = await client.fetchAll(
          candidates,
          { envelope: true, internalDate: true },
          { uid: true },
        );
        const senders = new Map<
          string,
          {
            name: string | null;
            address: string;
            count: number;
            latestAt: string | null;
          }
        >();

        for (const message of messages) {
          const from = firstAddress(message.envelope?.from);
          if (!from.address) continue;
          const key = from.address.toLowerCase();
          const receivedAt = messageDate(message);
          const existing = senders.get(key);
          if (!existing) {
            senders.set(key, {
              name: from.name,
              address: from.address,
              count: 1,
              latestAt: receivedAt,
            });
            continue;
          }
          existing.count += 1;
          if ((receivedAt ?? "") > (existing.latestAt ?? "")) {
            existing.latestAt = receivedAt;
          }
          if (!existing.name && from.name) existing.name = from.name;
        }

        return {
          senders: [...senders.values()]
            .sort(
              (a, b) => b.count - a.count || a.address.localeCompare(b.address),
            )
            .slice(0, limit),
          scanned: candidates.length,
          truncated: uids.length > candidates.length,
        };
      } finally {
        lock.release();
      }
    });
  }

  async mailboxInventory(input: MailboxInventoryInput): Promise<{
    scope: string;
    matched: number;
    scanned: number;
    truncated: boolean;
    sample: {
      unread: number;
      seen: number;
      withAttachments: number;
      totalBytes: number;
    };
    dateRange: {
      oldestAt: string | null;
      newestAt: string | null;
    };
    byMonth: Array<{ month: string; count: number }>;
    senders: Array<{
      name: string | null;
      address: string;
      count: number;
      latestAt: string | null;
    }>;
    domains: Array<{ domain: string; count: number }>;
  }> {
    const folder = input.folder ?? "INBOX";
    const scanLimit = parseInventoryScanLimit(input.scanLimit);
    const limit = boundedLimit(input.limit, 25);

    return withClient(async (client) => {
      const lock = await client.getMailboxLock(folder, {
        readOnly: true,
        acquireTimeout: 10_000,
      });
      try {
        const found = await client.search(buildSearchQuery(input), {
          uid: true,
        });
        const uids = Array.isArray(found) ? found : [];
        const candidates = uids.slice(-scanLimit);
        const messages = candidates.length
          ? await client.fetchAll(
              candidates,
              {
                envelope: true,
                flags: true,
                internalDate: true,
                size: true,
                bodyStructure: true,
              },
              { uid: true },
            )
          : [];
        const senders = new Map<
          string,
          {
            name: string | null;
            address: string;
            count: number;
            latestAt: string | null;
          }
        >();
        const domains = new Map<string, number>();
        const months = new Map<string, number>();
        let unread = 0;
        let withAttachments = 0;
        let totalBytes = 0;
        let oldestAt: string | null = null;
        let newestAt: string | null = null;

        for (const message of messages) {
          const receivedAt = messageDate(message);
          const from = firstAddress(message.envelope?.from);
          const hasAttachments =
            findAttachments(message.bodyStructure).length > 0;
          const seen = message.flags?.has("\\Seen") ?? false;

          if (!seen) unread += 1;
          if (hasAttachments) withAttachments += 1;
          totalBytes += message.size ?? 0;
          if (receivedAt) {
            if (!oldestAt || receivedAt < oldestAt) oldestAt = receivedAt;
            if (!newestAt || receivedAt > newestAt) newestAt = receivedAt;
            const month = receivedAt.slice(0, 7);
            months.set(month, (months.get(month) ?? 0) + 1);
          }

          if (!from.address) continue;
          const key = from.address.toLowerCase();
          const sender = senders.get(key);
          if (sender) {
            sender.count += 1;
            if (!sender.name && from.name) sender.name = from.name;
            if ((receivedAt ?? "") > (sender.latestAt ?? "")) {
              sender.latestAt = receivedAt;
            }
          } else {
            senders.set(key, {
              name: from.name,
              address: from.address,
              count: 1,
              latestAt: receivedAt,
            });
          }

          const at = from.address.lastIndexOf("@");
          if (at > 0 && at < from.address.length - 1) {
            const domain = from.address.slice(at + 1).toLowerCase();
            domains.set(domain, (domains.get(domain) ?? 0) + 1);
          }
        }

        return {
          scope: folder,
          matched: uids.length,
          scanned: candidates.length,
          truncated: uids.length > candidates.length,
          sample: {
            unread,
            seen: messages.length - unread,
            withAttachments,
            totalBytes,
          },
          dateRange: { oldestAt, newestAt },
          byMonth: [...months.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([month, count]) => ({ month, count })),
          senders: [...senders.values()]
            .sort(
              (a, b) => b.count - a.count || a.address.localeCompare(b.address),
            )
            .slice(0, limit),
          domains: [...domains.entries()]
            .sort(
              ([a, countA], [b, countB]) =>
                countB - countA || a.localeCompare(b),
            )
            .slice(0, limit)
            .map(([domain, count]) => ({ domain, count })),
        };
      } finally {
        lock.release();
      }
    });
  }

  async cleanupCandidates(input: CleanupCandidatesInput): Promise<{
    scope: string;
    scanned: number;
    matched: number;
    truncated: boolean;
    criteria: {
      olderThanDays: number | null;
      minSenderCount: number;
      includeUnread: boolean;
    };
    candidates: Array<MessageSummary & { reasons: string[] }>;
  }> {
    const folder = input.folder ?? "INBOX";
    const scanLimit = parseInventoryScanLimit(input.scanLimit);
    const limit = boundedLimit(input.limit, 50);
    const olderThanDays = parseDays(input.olderThanDays);
    const minSenderCount = parseSenderThreshold(input.minSenderCount);
    const includeUnread = input.includeUnread === true;
    const cutoff = olderThanDays
      ? Date.now() - olderThanDays * 24 * 60 * 60 * 1000
      : null;

    return withClient(async (client) => {
      const lock = await client.getMailboxLock(folder, {
        readOnly: true,
        acquireTimeout: 10_000,
      });
      try {
        const searchInput = {
          ...input,
          seen: input.includeUnread ? input.seen : (input.seen ?? true),
        };
        const found = await client.search(buildSearchQuery(searchInput), {
          uid: true,
        });
        const uids = Array.isArray(found) ? found : [];
        const candidates = uids.slice(-scanLimit);
        const summaries = await fetchSummaries(client, folder, candidates);
        const senderCounts = new Map<string, number>();
        for (const summary of summaries) {
          const key = summary.from.address?.toLowerCase() ?? "";
          senderCounts.set(key, (senderCounts.get(key) ?? 0) + 1);
        }

        const results = summaries
          .map((summary) => {
            const reasons: string[] = [];
            const senderKey = summary.from.address?.toLowerCase() ?? "";
            if ((senderCounts.get(senderKey) ?? 0) >= minSenderCount) {
              reasons.push("frequent_sender");
            }
            if (
              cutoff !== null &&
              summary.seen &&
              summary.receivedAt &&
              new Date(summary.receivedAt).getTime() <= cutoff
            ) {
              reasons.push("old_read");
            }
            return reasons.length ? { ...summary, reasons } : null;
          })
          .filter(
            (summary): summary is MessageSummary & { reasons: string[] } =>
              summary !== null,
          )
          .slice(0, limit);

        return {
          scope: folder,
          scanned: summaries.length,
          matched: results.length,
          truncated: uids.length > candidates.length,
          criteria: {
            olderThanDays: olderThanDays ?? null,
            minSenderCount,
            includeUnread,
          },
          candidates: results,
        };
      } finally {
        lock.release();
      }
    });
  }

  async receiptCandidates(input: ReceiptCandidatesInput): Promise<{
    scope: string;
    scanned: number;
    matched: number;
    truncated: boolean;
    candidates: Array<MessageSummary & { reasons: string[] }>;
  }> {
    const folder = input.folder ?? "INBOX";
    const scanLimit = Math.min(parseInventoryScanLimit(input.scanLimit), 500);
    const limit = boundedLimit(input.limit, 50);
    const receiptPattern =
      /\b(receipt|invoice|order confirmation|payment confirmation|purchase|your order)\b/i;

    return withClient(async (client) => {
      const lock = await client.getMailboxLock(folder, {
        readOnly: true,
        acquireTimeout: 10_000,
      });
      try {
        const found = await client.search(
          buildSearchQuery({
            ...(input.before ? { before: input.before } : {}),
            ...(input.after ? { after: input.after } : {}),
          }),
          { uid: true },
        );
        const uids = Array.isArray(found) ? found : [];
        const candidates = uids.slice(-scanLimit);
        const summaries = await fetchSummaries(client, folder, candidates);
        const matched = summaries
          .filter((summary) => receiptPattern.test(summary.subject ?? ""))
          .map((summary) => ({ ...summary, reasons: ["receipt-subject"] }))
          .slice(0, limit);
        return {
          scope: folder,
          scanned: summaries.length,
          matched: matched.length,
          truncated: uids.length > candidates.length,
          candidates: matched,
        };
      } finally {
        lock.release();
      }
    });
  }

  async mailboxAnalysis(input: MailboxAnalysisInput): Promise<{
    scope: string;
    scanned: number;
    truncated: boolean;
    attachments: Array<{
      contentType: string;
      count: number;
      totalBytes: number;
      examples: string[];
    }>;
    duplicateGroups: Array<{
      fingerprint: string;
      count: number;
      ids: string[];
    }>;
    threadGroups: Array<{ subject: string; count: number; ids: string[] }>;
    newsletterCandidates: Array<{
      id: string;
      sender: AddressSummary;
      subject: string | null;
      listId: string | null;
      listUnsubscribe: string | null;
      reason: string;
    }>;
  }> {
    const folder = input.folder ?? "INBOX";
    const scanLimit = input.limit
      ? Math.min(input.limit, MAX_ANALYSIS_SCAN)
      : MAX_ANALYSIS_SCAN;
    return withClient(async (client) => {
      const lock = await client.getMailboxLock(folder, {
        readOnly: true,
        acquireTimeout: 10_000,
      });
      try {
        const found = await client.search(buildSearchQuery(input), {
          uid: true,
        });
        const uids = Array.isArray(found) ? found : [];
        const candidates = uids.slice(-scanLimit);
        const mailbox = client.mailbox;
        if (!mailbox) throw new Error("Mailbox was not opened");
        const messages = candidates.length
          ? await client.fetchAll(
              candidates,
              {
                envelope: true,
                internalDate: true,
                size: true,
                bodyStructure: true,
                headers: ["list-id", "list-unsubscribe", "precedence"],
              },
              { uid: true },
            )
          : [];
        const attachments = new Map<
          string,
          { count: number; totalBytes: number; examples: Set<string> }
        >();
        const duplicates = new Map<string, string[]>();
        const threads = new Map<string, { subject: string; ids: string[] }>();
        const newsletters: Array<{
          id: string;
          sender: AddressSummary;
          subject: string | null;
          listId: string | null;
          listUnsubscribe: string | null;
          reason: string;
        }> = [];

        for (const message of messages) {
          const summary = summarizeMessage(
            folder,
            mailbox.uidValidity,
            message,
          );
          for (const attachment of findAttachments(message.bodyStructure)) {
            const current = attachments.get(attachment.contentType) ?? {
              count: 0,
              totalBytes: 0,
              examples: new Set<string>(),
            };
            current.count += 1;
            current.totalBytes += attachment.size;
            if (attachment.filename && current.examples.size < 5) {
              current.examples.add(attachment.filename);
            }
            attachments.set(attachment.contentType, current);
          }

          const sender = summary.from.address?.toLowerCase() ?? "";
          const fingerprint = `${sender}|${normalizeSubject(summary.subject)}|${summary.size}`;
          duplicates.set(fingerprint, [
            ...(duplicates.get(fingerprint) ?? []),
            summary.id,
          ]);
          const threadSubject = normalizeSubject(summary.subject);
          if (threadSubject) {
            const thread = threads.get(threadSubject) ?? {
              subject: summary.subject ?? "",
              ids: [],
            };
            thread.ids.push(summary.id);
            threads.set(threadSubject, thread);
          }

          const listId = headerValue(message.headers, "list-id");
          const listUnsubscribe = headerValue(
            message.headers,
            "list-unsubscribe",
          );
          const precedence = headerValue(message.headers, "precedence");
          if (
            listId ||
            listUnsubscribe ||
            /^(bulk|list|junk)$/i.test(precedence ?? "")
          ) {
            newsletters.push({
              id: summary.id,
              sender: summary.from,
              subject: summary.subject,
              listId,
              listUnsubscribe,
              reason: listUnsubscribe
                ? "list-unsubscribe-header"
                : listId
                  ? "list-id-header"
                  : "bulk-precedence",
            });
          }
        }

        return {
          scope: folder,
          scanned: messages.length,
          truncated: uids.length > candidates.length,
          attachments: [...attachments.entries()]
            .map(([contentType, value]) => ({
              ...value,
              contentType,
              examples: [...value.examples],
            }))
            .sort((a, b) => b.totalBytes - a.totalBytes),
          duplicateGroups: [...duplicates.entries()]
            .filter(([, ids]) => ids.length > 1)
            .map(([fingerprint, ids]) => ({
              fingerprint,
              count: ids.length,
              ids,
            })),
          threadGroups: [...threads.values()]
            .filter((thread) => thread.ids.length > 1)
            .map((thread) => ({ ...thread, count: thread.ids.length })),
          newsletterCandidates: newsletters,
        };
      } finally {
        lock.release();
      }
    });
  }

  async getMessage(id: string): Promise<{
    id: string;
    folder: string;
    from: AddressSummary[];
    to: AddressSummary[];
    cc: AddressSummary[];
    subject: string | null;
    receivedAt: string | null;
    text: string | null;
    html: string | null;
    bodyTruncated: boolean;
    attachments: Array<{
      filename: string | null;
      contentType: string;
      size: number;
    }>;
  }> {
    const ref = decodeMessageId(id);

    return withClient(async (client) => {
      const lock = await client.getMailboxLock(ref.folder, {
        readOnly: true,
        acquireTimeout: 10_000,
      });
      try {
        const mailbox = client.mailbox;
        if (!mailbox) throw new Error("Mailbox was not opened");
        if (mailbox.uidValidity.toString() !== ref.uidValidity) {
          throw new Error(
            "Message id is stale because mailbox UIDVALIDITY changed",
          );
        }

        const message = await client.fetchOne(
          ref.uid,
          {
            envelope: true,
            internalDate: true,
            bodyStructure: true,
          },
          { uid: true },
        );
        if (!message) throw new Error("Message no longer exists");

        const plainPart = findBodyPart(message.bodyStructure, "text/plain");
        const htmlPart = findBodyPart(message.bodyStructure, "text/html");
        const plain = await downloadTextPart(client, ref.uid, plainPart);
        const html = await downloadTextPart(client, ref.uid, htmlPart);
        const text = plain?.text ?? null;

        return {
          id,
          folder: ref.folder,
          from: allAddresses(message.envelope?.from),
          to: allAddresses(message.envelope?.to),
          cc: allAddresses(message.envelope?.cc),
          subject: message.envelope?.subject ?? null,
          receivedAt: messageDate(message),
          text,
          html: html?.text ?? null,
          bodyTruncated:
            (plain?.truncated ?? false) || (html?.truncated ?? false),
          attachments: findAttachments(message.bodyStructure),
        };
      } finally {
        lock.release();
      }
    });
  }

  async extractReceipt(id: string) {
    const message = await this.getMessage(id);
    return {
      id: message.id,
      ...extractReceiptDetails(message),
      attachments: message.attachments,
    };
  }

  async markRead(input: MessageActionInput) {
    return this.mutateMessages(input.ids, input.dryRun, "read");
  }

  async markUnread(input: MessageActionInput) {
    return this.mutateMessages(input.ids, input.dryRun, "unread");
  }

  async archiveMessages(input: MessageActionInput) {
    return this.mutateMessages(input.ids, input.dryRun, "archive");
  }

  async trashMessages(input: MessageActionInput) {
    return this.mutateMessages(input.ids, input.dryRun, "trash");
  }

  async moveMessages(input: MoveMessagesInput) {
    if (!input.destination.trim()) throw new Error("destination is required");
    return this.mutateMessages(
      input.ids,
      input.dryRun,
      "move",
      input.destination.trim(),
    );
  }

  async copyMessages(input: MoveMessagesInput) {
    if (!input.destination.trim()) throw new Error("destination is required");
    return this.mutateMessages(
      input.ids,
      input.dryRun,
      "copy",
      input.destination.trim(),
    );
  }
}
