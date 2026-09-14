/** What distribution refuses, as codes. */
export const ChannelError = {
  CONNECTION_NOT_FOUND: "channel.connection_not_found",
  MAPPING_NOT_FOUND: "channel.mapping_not_found",
  /** A type sold on a channel that no longer maps to anything here. */
  MAPPING_UNKNOWN: "channel.mapping_unknown",
  CONNECTION_PAUSED: "channel.connection_paused",
  CONNECTION_EXISTS: "channel.connection_exists",
  /** An active connection whose secret cannot be read — see `server/credentials.ts`. */
  CREDENTIALS_MISSING: "channel.credentials_missing",
} as const;

export type ChannelError = (typeof ChannelError)[keyof typeof ChannelError];
