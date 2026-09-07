# The last-admin guard is untested

`features/identity/server/router.ts:68-91` refuses to demote the final `ADMIN`.
It is the only branch in the codebase whose failure is unrecoverable from
inside the app: `adminProcedure` is the sole route to `updateRole`, and the
demotion is what removes it. Get it wrong and the install has no way back to
user management short of editing the database.

It has no test. All sixteen tests in `src/` are pure functions in `model/`.

## Why it ended up outside `model/`

`../guides/index.md` says `model/` is the half worth testing, because those
functions decide what the router permits *and* what the UI offers. This guard
could not live there as written: it needs a row count.

```
const remainingAdmins = await ctx.db.user.count({
  where: { role: UserRole.ADMIN, id: { not: input.id } },
});
```

So the rule and the I/O are fused, and the rule is the part worth testing.

## What to do

Prefer splitting over mocking. Move the *decision* into `model/user.ts` as a
pure function over facts the router has already fetched — roughly
"target is an admin, and no other admin remains, so refuse" — and leave the
router owning only the two queries and the throw. The guard then becomes
testable the same way `canListUsers` and `canSetUserRole` already are, with no
harness at all, and it lands in the file the guides point at.

Pin at least these cases:

- demoting an admin while others remain — allowed
- demoting the last admin — refused
- demoting a non-admin — allowed, and asks no question about admin counts
- promoting anyone — allowed, and never reaches the count

Self-demotion is deliberately legal while another admin remains. Do not pin a
test that forbids it; the invariant is *last admin*, not *self*.

If a later procedure genuinely needs end-to-end coverage, `server/caller.ts`
already builds one with `createCallerFactory(appRouter)`, so a test can call
procedures directly with a substituted context. Reach for that second — it
tests the wiring, and the wiring is not what is dangerous here.

## Done when

- `npm test` covers all four cases above.
- `router.ts` contains the queries and the throw, not the rule.
