import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CleanupStateStore } from "./state.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function stateStore(): Promise<CleanupStateStore> {
  const directory = await mkdtemp(join(tmpdir(), "proton-mcp-state-"));
  tempDirs.push(directory);
  return new CleanupStateStore(directory);
}

describe("cleanup workflow state", () => {
  it("persists a review-only bulk manifest", async () => {
    const store = await stateStore();
    const run = await store.createBulkRun({
      action: "archive",
      sourceFolder: "INBOX",
      criteria: { folder: "INBOX", seen: true },
      candidateIds: ["message-1", "message-2"],
      manifestDigest: "digest",
    });

    expect(run).toMatchObject({
      action: "archive",
      candidateCount: 2,
      status: "pending_review",
      manifestDigest: "digest",
    });
    const summaries = await store.listBulkRuns();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({ candidateCount: 2 });
    expect(summaries[0]).not.toHaveProperty("candidateIds");
    await expect(store.getBulkRun(run.id)).resolves.toEqual(run);
  });

  it("returns a one-time token without exposing its stored hash", async () => {
    const store = await stateStore();
    const plan = await store.createPlan({
      action: "archive",
      ids: ["message-id"],
      sourceFolder: "INBOX",
    });

    expect(plan.confirmationToken).toBeTruthy();
    expect(plan).not.toHaveProperty("confirmationHash");
    await expect(store.claimPlan(plan.id, "wrong-token")).rejects.toThrow(
      /confirmation token is invalid/,
    );
  });

  it("claims a plan once and persists an exact undo record", async () => {
    const store = await stateStore();
    const plan = await store.createPlan({
      action: "move",
      ids: ["message-id"],
      sourceFolder: "INBOX",
      destination: "Archive",
    });

    await store.claimPlan(plan.id, plan.confirmationToken);
    await expect(
      store.claimPlan(plan.id, plan.confirmationToken),
    ).rejects.toThrow(/in_progress/);
    const operation = await store.completePlan(plan.id, {
      action: "move",
      sourceFolder: "INBOX",
      destination: "Archive",
      undo: { sourceFolder: "INBOX", destinationIds: ["destination-id"] },
    });

    expect(await store.listOperations()).toEqual([operation]);
    await expect(store.claimUndo(operation.id)).resolves.toMatchObject({
      id: operation.id,
      status: "undo_in_progress",
    });
  });

  it("refuses undo where Bridge did not return an exact UID mapping", async () => {
    const store = await stateStore();
    const plan = await store.createPlan({
      action: "copy",
      ids: ["message-id"],
      sourceFolder: "INBOX",
      destination: "Archive",
    });
    await store.claimPlan(plan.id, plan.confirmationToken);
    const operation = await store.completePlan(plan.id, {
      action: "copy",
      sourceFolder: "INBOX",
      destination: "Archive",
    });

    await expect(store.claimUndo(operation.id)).rejects.toThrow(
      /cannot be undone/,
    );
  });

  it("creates a disabled rule and produces a confirmation plan only for matches", async () => {
    const store = await stateStore();
    const rule = await store.createRule({
      name: "Archive old notices",
      enabled: false,
      action: "archive",
      match: { folder: "INBOX", from: "notices@example.test" },
    });
    await expect(
      store.createRuleRun(rule.id, ["message-id"], "INBOX"),
    ).rejects.toThrow(/disabled/);
    await store.setRuleEnabled(rule.id, true);

    const empty = await store.createRuleRun(rule.id, [], "INBOX");
    expect(empty.run.status).toBe("no_matches");
    expect(empty.plan).toBeUndefined();

    const prepared = await store.createRuleRun(
      rule.id,
      ["message-id"],
      "INBOX",
    );
    expect(prepared.run.status).toBe("pending_confirmation");
    expect(prepared.plan).toMatchObject({
      action: "archive",
      ids: ["message-id"],
    });
    expect(await store.listRuleRuns(rule.id)).toHaveLength(2);
  });

  it("updates disabled rules and cancels unused plans when deleting them", async () => {
    const store = await stateStore();
    const rule = await store.createRule({
      name: "Old",
      enabled: false,
      action: "archive",
      match: { folder: "INBOX", from: "old@example.test" },
    });
    const updated = await store.updateRule(rule.id, {
      name: "New",
      action: "trash",
      match: { folder: "INBOX", from: "new@example.test" },
    });
    expect(updated).toMatchObject({ name: "New", action: "trash" });
    await store.setRuleEnabled(rule.id, true);
    await expect(
      store.updateRule(rule.id, {
        name: "No",
        action: "trash",
        match: { folder: "INBOX", from: "new@example.test" },
      }),
    ).rejects.toThrow(/Disable/);
    await store.createRuleRun(rule.id, ["message-id"], "INBOX");
    await store.setRuleEnabled(rule.id, false);
    await expect(store.deleteRule(rule.id)).resolves.toEqual({
      cancelledPlans: 1,
    });
    expect(await store.listRules()).toEqual([]);
    expect(await store.listRuleRuns(rule.id)).toMatchObject([
      { status: "cancelled" },
    ]);
  });
});
