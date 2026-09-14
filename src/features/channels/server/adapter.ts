import "server-only";
import type { NightState } from "../model";
import type { ChannelSecret } from "./credentials";

/**
 * What a channel manager has to be able to do, and nothing more.
 *
 * **One interface, one certification.** `hotel-pms.md` decision 5: a wholesale
 * channel manager reaches sixty OTAs behind a single integration, where direct
 * connections mean repeating certification per channel for ever. So this is the
 * seam a vendor is implemented behind, not a seam per OTA.
 *
 * Deliberately small. Everything a channel *decides* — what a rate looks like,
 * how a restriction is spelled, how many messages a minute — belongs inside an
 * implementation, and everything the hotel decides is already computed by the
 * time it gets here.
 */

export type ChannelCredentials = {
  /**
   * The secret itself, already read out of `CHANNEL_SECRETS_DIR` by
   * `server/credentials.ts` — the adapter never learns where it came from.
   *
   * A bag of fields rather than one string, because "the API key" is one field
   * for one vendor and three for another. An adapter takes what it needs and
   * throws by name for what it was not given; the message reaches a dead letter
   * with the connection on it.
   */
  secret: ChannelSecret;
  /** What the vendor calls this property. */
  externalPropertyId: string | null;
};

export type PushNight = NightState & {
  /** What this channel calls the room type. Absent means it is not mapped. */
  externalRoomTypeId: string;
  externalRatePlanId: string | null;
};

export type PushResult = {
  /** The nights the channel accepted. Only these update the mirror. */
  accepted: PushNight[];
  /** The rest, each with why — a partial success is the normal case. */
  rejected: { night: PushNight; reason: string }[];
};

export type InboundReservation = {
  /** The channel's own id. The half of the idempotency key it owns. */
  externalRef: string;
  externalRoomTypeId: string;
  checkIn: Date;
  checkOut: Date;
  adults: number;
  children: number;
  totalMinor: number;
  currencyCode: string;
  guest: { firstName: string; lastName: string; email?: string };
  /** The channel says it is cancelled; we do not infer that from absence. */
  cancelled: boolean;
};

export interface ChannelAdapter {
  readonly provider: string;

  /**
   * Tell the channel about these nights.
   *
   * A **difference**, computed by `nightsToPush` before it arrives here — an
   * adapter that re-sent everything would be undoing the point of the mirror.
   */
  push(credentials: ChannelCredentials, nights: PushNight[]): Promise<PushResult>;

  /**
   * Reservations made there.
   *
   * Pulled rather than pushed to us, and **applied idempotently**: networks
   * retry, so receiving the same one twice has to produce one booking. The
   * `(propertyId, channelCode, externalRef)` unique is what makes that true,
   * and it is the database enforcing it rather than this contract asking.
   */
  pull(credentials: ChannelCredentials, since: Date): Promise<InboundReservation[]>;
}

import { channexAdapter } from "./adapters/channex";
import { exampleVendorAdapter, mockAdapter } from "./adapters/mock";

/**
 * The adapter for a provider, or `null`.
 *
 * Implements wholesale channel manager adapters (e.g. Channex) and mock
 * test adapters registered by provider name.
 */
const ADAPTERS: Record<string, ChannelAdapter> = {};

export function adapterFor(provider: string): ChannelAdapter | null {
  return ADAPTERS[provider] ?? null;
}

export function registerAdapter(adapter: ChannelAdapter): void {
  ADAPTERS[adapter.provider] = adapter;
}

registerAdapter(channexAdapter);
registerAdapter(mockAdapter);
registerAdapter(exampleVendorAdapter);
