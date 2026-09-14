import "server-only";
import type {
  ChannelAdapter,
  ChannelCredentials,
  InboundReservation,
  PushNight,
  PushResult,
} from "../adapter";

const DEFAULT_BASE_URL = "https://staging.channex.io/api/v1";

type ChannexValue = {
  property_id: string;
  room_type_id: string;
  rate_plan_id?: string;
  date_from: string;
  date_to: string;
  availability?: number;
  rate?: number;
};

type ChannexBooking = {
  id: string;
  attributes: {
    ota_reservation_code?: string;
    property_id?: string;
    room_type_id?: string;
    arrival_date: string;
    departure_date: string;
    adults?: number;
    children?: number;
    total_price?: number;
    currency?: string;
    status?: string;
    customer?: {
      name?: string;
      surname?: string;
      email?: string;
    };
    rooms?: {
      room_type_id: string;
    }[];
  };
};

/** Wholesale channel manager integration via Channex REST API v1. */
export class ChannexAdapter implements ChannelAdapter {
  readonly provider = "channex";

  private getApiKey(credentials: ChannelCredentials): string {
    const key = credentials.secret.apiKey ?? credentials.secret.api_key;
    if (!key) {
      throw new Error("channex: missing apiKey in secret");
    }
    return key;
  }

  private getBaseUrl(credentials: ChannelCredentials): string {
    return credentials.secret.baseUrl ?? DEFAULT_BASE_URL;
  }

  async push(credentials: ChannelCredentials, nights: PushNight[]): Promise<PushResult> {
    if (nights.length === 0) return { accepted: [], rejected: [] };

    const apiKey = this.getApiKey(credentials);
    const baseUrl = this.getBaseUrl(credentials);
    const propertyId = credentials.externalPropertyId;

    if (!propertyId) {
      throw new Error("channex: externalPropertyId is required");
    }

    // Mock bypass for offline test suites
    if (apiKey === "mock" || credentials.secret.mock === "true") {
      return { accepted: nights, rejected: [] };
    }

    const values: ChannexValue[] = nights.map((night) => {
      const dateStr = night.date.toISOString().slice(0, 10);
      const value: ChannexValue = {
        property_id: propertyId,
        room_type_id: night.externalRoomTypeId,
        date_from: dateStr,
        date_to: dateStr,
        availability: night.availability,
      };
      if (night.externalRatePlanId) {
        value.rate_plan_id = night.externalRatePlanId;
      }
      if (night.priceMinor !== null) {
        value.rate = night.priceMinor / 100;
      }
      return value;
    });

    try {
      const response = await fetch(`${baseUrl}/restrictions`, {
        method: "POST",
        headers: {
          "user-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ values }),
      });

      if (!response.ok) {
        const text = await response.text();
        const reason = `Channex HTTP ${response.status}: ${text.slice(0, 120)}`;
        return {
          accepted: [],
          rejected: nights.map((night) => ({ night, reason })),
        };
      }

      return { accepted: nights, rejected: [] };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "network error";
      return {
        accepted: [],
        rejected: nights.map((night) => ({ night, reason })),
      };
    }
  }

  async pull(credentials: ChannelCredentials, since: Date): Promise<InboundReservation[]> {
    const apiKey = this.getApiKey(credentials);
    const baseUrl = this.getBaseUrl(credentials);
    const propertyId = credentials.externalPropertyId;

    if (!propertyId) {
      throw new Error("channex: externalPropertyId is required");
    }

    if (apiKey === "mock" || credentials.secret.mock === "true") {
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

    const params = new URLSearchParams({
      "filter[property_id]": propertyId,
      "filter[updated_at][gte]": since.toISOString(),
    });

    const response = await fetch(`${baseUrl}/bookings?${params.toString()}`, {
      headers: { "user-api-key": apiKey },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Channex HTTP ${response.status}: ${text.slice(0, 120)}`);
    }

    const body = (await response.json()) as { data?: ChannexBooking[] };
    const bookings = body.data ?? [];

    return bookings.map((b) => {
      const attr = b.attributes;
      const roomTypeId = attr.room_type_id ?? attr.rooms?.[0]?.room_type_id ?? "";
      return {
        externalRef: attr.ota_reservation_code ?? b.id,
        externalRoomTypeId: roomTypeId,
        checkIn: new Date(attr.arrival_date),
        checkOut: new Date(attr.departure_date),
        adults: attr.adults ?? 1,
        children: attr.children ?? 0,
        totalMinor: Math.round((attr.total_price ?? 0) * 100),
        currencyCode: attr.currency ?? "EUR",
        guest: {
          firstName: attr.customer?.name ?? "Guest",
          lastName: attr.customer?.surname ?? "Channex",
          email: attr.customer?.email,
        },
        cancelled: attr.status === "cancelled",
      };
    });
  }
}

export const channexAdapter = new ChannexAdapter();
