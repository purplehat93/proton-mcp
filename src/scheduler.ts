import { ProtonMailbox } from "./mail.js";
import { CleanupStateStore } from "./state.js";

const TICK_MS = 60_000;

export function startAutomationScheduler(): () => void {
  const store = new CleanupStateStore();
  const mailbox = new ProtonMailbox();
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      for (const rule of await store.listDueRules()) {
        try {
          const result = await mailbox.searchMail({ ...rule.match, limit: 50 });
          await store.recordScheduledRun(
            rule.id,
            result.messages.map((message) => message.id),
          );
        } catch (error) {
          console.error(
            "automation scheduler rule failed",
            rule.id,
            error instanceof Error ? error.message : error,
          );
        }
      }
    } finally {
      running = false;
    }
  };
  const interval = setInterval(() => {
    void tick();
  }, TICK_MS);
  void tick();
  return () => clearInterval(interval);
}
