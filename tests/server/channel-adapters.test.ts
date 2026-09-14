import "dotenv/config";
import assert from "node:assert/strict";
import { test } from "node:test";
import { adapterFor } from "@/features/channels/server";
import type { PushNight } from "@/features/channels/server";
import { ChannexAdapter } from "@/features/channels/server/adapters/channex";
import { MockChannelAdapter } from "@/features/channels/server/adapters/mock";

const night = (over: Partial<PushNight> = {}): PushNight => ({
  roomTypeId: 1,
  externalRoomTypeId: "DBL",
  externalRatePlanId: null,
  date: new Date(Date.UTC(2027, 5, 1)),
  availability: 3,
  priceMinor: 10_000,
  restrictions: null,
  ...over,
});

test("registered adapters can be retrieved by provider name", () => {
  assert.notEqual(adapterFor("channex"), null);
  assert.notEqual(adapterFor("mock"), null);
  assert.notEqual(adapterFor("example-vendor"), null);
  assert.equal(adapterFor("unregistered-vendor"), null);
});

test("mock adapter accepts nights and rejects marked nights", async () => {
  const adapter = new MockChannelAdapter();
  const creds = { secret: {}, externalPropertyId: "PROP-1" };

  const res = await adapter.push(creds, [
    night(),
    night({ roomTypeId: 2, restrictions: "REJECT" }),
  ]);

  assert.equal(res.accepted.length, 1);
  assert.equal(res.rejected.length, 1);
  assert.equal(res.rejected[0]?.night.roomTypeId, 2);
});

test("channex adapter validates credentials before pushing", async () => {
  const adapter = new ChannexAdapter();

  await assert.rejects(
    adapter.push({ secret: {}, externalPropertyId: "PROP-1" }, [night()]),
    /missing apiKey/i
  );

  await assert.rejects(
    adapter.push({ secret: { apiKey: "key" }, externalPropertyId: null }, [night()]),
    /externalPropertyId is required/i
  );
});

test("channex adapter supports mock mode for test environments", async () => {
  const adapter = new ChannexAdapter();
  const creds = {
    secret: { apiKey: "mock" },
    externalPropertyId: "PROP-1",
  };

  const res = await adapter.push(creds, [night()]);
  assert.equal(res.accepted.length, 1);
  assert.equal(res.rejected.length, 0);
});

test("channex adapter parses simulated inbound arrivals", async () => {
  const adapter = new ChannexAdapter();
  const mockArrival = {
    externalRef: "CHX-101",
    externalRoomTypeId: "DBL",
    checkIn: "2027-06-01T00:00:00.000Z",
    checkOut: "2027-06-03T00:00:00.000Z",
    adults: 2,
    children: 0,
    totalMinor: 20000,
    currencyCode: "EUR",
    guest: { firstName: "Test", lastName: "Guest" },
    cancelled: false,
  };

  const creds = {
    secret: {
      apiKey: "mock",
      mockArrivalsJson: JSON.stringify([mockArrival]),
    },
    externalPropertyId: "PROP-1",
  };

  const arrivals = await adapter.pull(creds, new Date(0));
  assert.equal(arrivals.length, 1);
  assert.equal(arrivals[0]?.externalRef, "CHX-101");
  assert.equal(arrivals[0]?.totalMinor, 20000);
});
