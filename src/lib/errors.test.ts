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
        fieldErrors: { email: ["email_invalid"] },
      },
    })
  );

  assert.equal(app.kind, "field");
  // A Zod message is a key by the time it reaches here; `handleFormError`
  // resolves it when placing, which is what `translateField` is for.
  assert.deepEqual(app.fieldErrors, { email: ["email_invalid"] });
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

test("a domain code with a translation replaces the server's English", () => {
  const app = normalizeError(
    trpc(
      { code: "CONFLICT", httpStatus: 409, domainCode: "room.taken" },
      "English from the server"
    ),
    (code) => (code === "room.taken" ? "Translated" : null)
  );

  assert.equal(app.message, "Translated");
  assert.equal(app.domainCode, "room.taken");
});

test("a code the translation does not cover keeps the server's English", () => {
  // The five refusals whose sentence comes from a `model/` rule are exactly
  // this case: a code, and no key that could reproduce the sentence.
  const app = normalizeError(
    trpc(
      { code: "BAD_REQUEST", httpStatus: 400, domainCode: "reservation.status_refused" },
      "A confirmed reservation cannot become checked out"
    ),
    () => null
  );

  assert.equal(app.message, "A confirmed reservation cannot become checked out");
});

test("the values a computed refusal carried reach the translator", () => {
  let seen: Record<string, string | number> | undefined;
  normalizeError(
    trpc(
      {
        code: "CONFLICT",
        httpStatus: 409,
        domainCode: "hold.short",
        domainValues: { available: 3, date: "2027-03-04" },
      },
      "Only 3 free on 2027-03-04"
    ),
    (_code, values) => {
      seen = values;
      return "translated";
    }
  );

  assert.deepEqual(seen, { available: 3, date: "2027-03-04" });
});

test("no translator at all is the server's English, not a blank", () => {
  const app = normalizeError(
    trpc({ code: "NOT_FOUND", httpStatus: 404, domainCode: "room.not_found" }, "Room not found")
  );

  assert.equal(app.message, "Room not found");
});

test("a translated 500 is still not shown — the message is for a log", () => {
  const app = normalizeError(
    trpc({ code: "INTERNAL_SERVER_ERROR", httpStatus: 500, domainCode: "x.y" }, "at Object.<anon>"),
    () => "a translation that must not appear"
  );

  assert.equal(app.message, GENERIC_SERVER_MESSAGE);
});

/* --- The third dialect: a file transfer ----------------------------------- */

/** What `lib/upload.ts` throws, by shape — this file must not import XHR code. */
function transferError(status: number) {
  const error = new Error("Upload failed") as Error & { status: number };
  error.name = "UploadTransferError";
  error.status = status;
  return error;
}

test("a lapsed reservation says so, rather than 'something went wrong'", () => {
  // 409 and 410 both mean the row is no longer PENDING. Before this branch
  // they fell to the catch-all and the one useful fact was discarded.
  for (const status of [409, 410]) {
    const error = normalizeError(transferError(status), (code) => `translated:${code}`);
    assert.equal(error.domainCode, "attachment.not_pending", String(status));
    assert.equal(error.message, "translated:attachment.not_pending");
  }
});

test("a refused size is worded without the kind, which the transport does not know", () => {
  const error = normalizeError(transferError(413), (code) => `translated:${code}`);
  assert.equal(error.domainCode, "attachment.transfer_too_large");
});

test("a transfer that never left is a network problem, not a refusal", () => {
  const error = normalizeError(transferError(0));
  assert.equal(error.kind, "network");
  assert.equal(error.domainCode, undefined);
});

test("an ordinary auth error is still read as one", () => {
  // `authErrorOf` matches anything with a numeric status, so the upload branch
  // has to run first without swallowing Better Auth's shape.
  const error = normalizeError({ status: 401, message: "Nope" });
  assert.equal(error.kind, "auth");
});
