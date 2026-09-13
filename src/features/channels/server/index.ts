import { PULL_HANDLERS } from "./pull";
import { PUSH_HANDLERS } from "./push";
import type { OutboxHandlers } from "@/features/platform/server/outbox";

export * from "./adapter";
export * from "./enqueue";
export * from "./inbound";
export * from "./pull";
export * from "./push";
export * from "./router";

/** Both directions, for the worker to register in one line. */
export const CHANNEL_HANDLERS: OutboxHandlers = {
  ...PUSH_HANDLERS,
  ...PULL_HANDLERS,
};
