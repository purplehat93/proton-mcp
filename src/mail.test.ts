import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { decodeMessageId, encodeMessageId, loadImapConfig } from "./mail.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("Bridge IMAP configuration", () => {
  it("loads the password from a secret file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "proton-mcp-"));
    tempDirs.push(dir);
    const secret = join(dir, "password");
    await writeFile(secret, "bridge-secret\n", { mode: 0o600 });

    await expect(
      loadImapConfig({
        BRIDGE_IMAP_HOST: "127.0.0.1",
        BRIDGE_IMAP_PORT: "1143",
        BRIDGE_IMAP_USERNAME: "user@example.com",
        BRIDGE_IMAP_PASSWORD_FILE: secret,
        BRIDGE_IMAP_SECURITY: "STARTTLS",
      }),
    ).resolves.toEqual({
      host: "127.0.0.1",
      port: 1143,
      username: "user@example.com",
      password: "bridge-secret",
      security: "STARTTLS",
      tlsRejectUnauthorized: false,
    });
  });

  it("rejects a non-loopback Bridge host", async () => {
    await expect(
      loadImapConfig({
        BRIDGE_IMAP_HOST: "192.168.1.10",
        BRIDGE_IMAP_USERNAME: "user@example.com",
      }),
    ).rejects.toThrow(/must be loopback/);
  });
});

describe("opaque message ids", () => {
  it("round-trips folder, UID and UIDVALIDITY", () => {
    const encoded = encodeMessageId({
      v: 1,
      folder: "Folders/Receipts",
      uid: 42,
      uidValidity: "123456789",
    });

    expect(decodeMessageId(encoded)).toEqual({
      v: 1,
      folder: "Folders/Receipts",
      uid: 42,
      uidValidity: "123456789",
    });
  });

  it("rejects malformed ids", () => {
    expect(() => decodeMessageId("not-an-id")).toThrow("Invalid message id");
  });
});
