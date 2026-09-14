import "server-only";
import type {
  ChannelAdapter,
  ChannelCredentials,
  InboundReservation,
  PushNight,
  PushResult,
} from "../adapter";

/** In-memory simulated channel adapter for offline tests and local development. */
export class MockChannelAdapter implements ChannelAdapter {
  constructor(readonly provider: string = "mock") {}

  async push(_credentials: ChannelCredentials, nights: PushNight[]): Promise<PushResult> {
    const accepted: PushNight[] = [];
    const rejected: { night: PushNight; reason: string }[] = [];

    for (const night of nights) {
      if (night.restrictions === "REJECT") {
        rejected.push({ night, reason: "mock rejection" });
      } else {
        accepted.push(night);
      }
    }

    return { accepted, rejected };
  }

  async pull(credentials: ChannelCredentials, since: Date): Promise<InboundReservation[]> {
    void since;
    const raw = credentials.secret.mockArrivalsJson;
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as InboundReservation[];
      return parsed.map((item) => ({
        ...item,
        checkIn: new Date(item.checkIn),
        checkOut: new Date(item.checkOut),
      }));
    } catch {
      return [];
    }
  }
}

export const mockAdapter = new MockChannelAdapter("mock");
export const exampleVendorAdapter = new MockChannelAdapter("example-vendor");
