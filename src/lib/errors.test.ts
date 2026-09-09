import assert from "node:assert/strict";
import { test } from "node:test";

import { fieldEntriesOf, GENERIC_SERVER_MESSAGE, normalizeError } from "./errors";

/**
 * The mapping is the whole architecture: where an error renders is decided
 * here, once, instead of in nine `onError` handlers. Pure input and pure
 * output — no DOM, no toast, no router.
 *
 * The fixtures are shaped by hand rather than thrown by tRPC on purpose:
 * `normalizeError` recognises errors by shape, so a hand-built fixture tests
 * exactly what arrives over the wire.
 */

const trpc = (data: Record<string, unknown>, message = "boom") => ({ message, data });

test("a Zod failure becomes field errors, under the names the server used", () => {
  const app = normalizeError(
    trpc({
      code: "BAD_REQUEST",
      httpStatus: 400,
      zodError: {
        formErrors: [],
        fieldErrors: { email: ["Enter a valid email address"] },
      },
    })
  );

  assert.equal(app.kind, "field");
  assert.deepEqual(app.fieldErrors, { email: ["Enter a valid email address"] });
});

test("fieldError() puts a domain rule under its field", () => {
  // "That slug is already taken" is a CONFLICT no schema can express — it needs
  // the database. The server names the field; this is what carries it across.
  const app = normalizeError(
    trpc({ code: "CONFLICT", httpStatus: 409, field: "slug" }, "That slug is already taken")
  );

  assert.equal(app.kind, "field");
  assert.deepEqual(app.fieldErrors, { slug: ["That slug is already taken"] });
});

test("a named field outranks the code it arrived with", () => {
  // "No account with that email" is a NOT_FOUND, but it is fixable by editing
  // the email box — so it belongs under the box, not in a toast.
  const app = normalizeError(
    trpc({ code: "NOT_FOUND", httpStatus: 404, field: "email" }, "No account with that email.")
  );

  assert.equal(app.kind, "field");
});

test("a 500 never shows what the server said", () => {
  // The message at that point is quoting a driver or a connection string at
  // someone who cannot act on it. This is the leak test.
  const leaky = "Invalid `prisma.user.findUnique()`: connection to db:5432 refused";
  const app = normalizeError(trpc({ code: "INTERNAL_SERVER_ERROR", httpStatus: 500 }, leaky));

  assert.equal(app.kind, "server");
  assert.equal(app.message, GENERIC_SERVER_MESSAGE);
  assert.ok(!app.message.includes("prisma"));
});

test("an unrecognised tRPC code is treated as ours, not theirs", () => {
  const app = normalizeError(trpc({ code: "NOT_IMPLEMENTED", httpStatus: 501 }, "nope"));
  assert.equal(app.kind, "server");
  assert.equal(app.message, GENERIC_SERVER_MESSAGE);
});

test("Better Auth's returned error normalises like a thrown one", () => {
  // authClient resolves with `{ data, error }` instead of throwing, and the
  // error is a different shape entirely. Callers should not have to know.
  const app = normalizeError({
    message: "Invalid email or password",
    status: 401,
    statusText: "UNAUTHORIZED",
    code: "INVALID_EMAIL_OR_PASSWORD",
  });

  assert.equal(app.kind, "auth");
  assert.equal(app.message, "Invalid email or password");
  assert.equal(app.code, "INVALID_EMAIL_OR_PASSWORD");
});

test("status maps the same way the tRPC codes do", () => {
  assert.equal(normalizeError({ status: 403 }).kind, "forbidden");
  assert.equal(normalizeError({ status: 404 }).kind, "notFound");
  assert.equal(normalizeError({ status: 409 }).kind, "form");
  assert.equal(normalizeError({ status: 503 }).kind, "server");
});

test("a request that never left is not the person's fault", () => {
  const app = normalizeError(new TypeError("Failed to fetch"));
  assert.equal(app.kind, "network");
  assert.ok(!app.message.includes("fetch"));
});

test("anything at all can be handed in without throwing", () => {
  // This runs inside an `onError`; throwing here would replace a bad password
  // message with a blank screen.
  for (const value of [undefined, null, "boom", 42, {}, [], new Error("x")]) {
    const app = normalizeError(value);
    assert.equal(app.kind, "server");
    assert.equal(app.message, GENERIC_SERVER_MESSAGE);
  }
});

test("fieldEntriesOf flattens to one message per pair", () => {
  const app = normalizeError(
    trpc({
      code: "BAD_REQUEST",
      httpStatus: 400,
      zodError: { formErrors: [], fieldErrors: { slug: ["too short", "bad characters"] } },
    })
  );

  assert.deepEqual(fieldEntriesOf(app), [
    ["slug", "too short"],
    ["slug", "bad characters"],
  ]);
});

test("form-level Zod messages stay separate from field ones", () => {
  const app = normalizeError(
    trpc({
      code: "BAD_REQUEST",
      httpStatus: 400,
      zodError: { formErrors: ["Pick at least one"], fieldErrors: {} },
    })
  );

  assert.equal(app.kind, "form");
  assert.deepEqual(app.formErrors, ["Pick at least one"]);
  assert.equal(app.fieldErrors, undefined);
});

test("a domain code survives the wire, alongside the transport's own", () => {
  const app = normalizeError(
    trpc(
      {
        code: "CONFLICT",
        httpStatus: 409,
        domainCode: "room.taken",
        field: "roomId",
      },
      "That room is taken for part of this stay"
    )
  );

  // Two codes, and they answer different questions: `code` is the transport's
  // and decides where this renders; `domainCode` is the rule's and is what a
  // screen or a translation keys on.
  assert.equal(app.code, "CONFLICT");
  assert.equal(app.domainCode, "room.taken");
  assert.deepEqual(app.fieldErrors, { roomId: ["That room is taken for part of this stay"] });
});

test("an error with no domain code does not invent one", () => {
  const app = normalizeError(trpc({ code: "NOT_FOUND", httpStatus: 404 }, "Gone"));

  assert.equal("domainCode" in app, false);
});

test("a null domain code is an absence, not a value", () => {
  // The formatter writes `null` when the cause was not a `DomainError`, and a
  // caller checking `app.domainCode === X` must not match on that.
  const app = normalizeError(
    trpc({ code: "NOT_FOUND", httpStatus: 404, domainCode: null }, "Gone")
  );

  assert.equal(app.domainCode, undefined);
});

test("a domain code never rescues a 500's message", () => {
  const app = normalizeError(
    trpc({ code: "INTERNAL_SERVER_ERROR", httpStatus: 500, domainCode: "x.y" }, "at Object.<anon>")
  );

  assert.equal(app.message, GENERIC_SERVER_MESSAGE);
  assert.equal(app.domainCode, "x.y");
});
