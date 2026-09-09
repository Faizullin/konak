# Todo

The next few things, in order. A title and one line of why — no status, no
boxes. A finished item leaves here; the fact of it goes to `history.md`.

Where this sits in the whole build: `plans/roadmap.md`.

## Class-based exceptions on the server
Forty-four `throw new TRPCError` sites each carry their own English sentence, and
`server/errors.ts` names only the two that repeat. A small hierarchy thrown by
the domain and mapped to `TRPCError` once at the boundary would leave codes where
sentences are now: the translation entry below needs exactly that, and a router
becomes testable without asserting on prose. `lib/errors.ts` keeps matching by
shape either way — the comment there says why `instanceof` is not an option.

## Pick a translation library
Every string in the app is inline English and nothing is installed. The field is
`next-intl`, `next-i18next` v16, Lingui and Paraglide. Two findings that outlive
the choice: `next-i18next` v16 is an App Router library now (`getT`/`useT`,
`localeInPath: false` keeps our URLs), so anything written against
`appWithTranslation` is a different package; and Paraglide has no App Router
story at all — its SSR wants the server entry we do not own.

The routers decide this more than the components do. Half the strings a user sees
are `TRPCError` messages written in English on the server, and every candidate
makes a route handler pass the locale explicitly. Prisma content — room types,
rate plans — is a schema question none of them answer.

## Next 16, read against the docs
We are on 15.5.9 and nextjs.org now documents 16.3. The parts that touch
decisions we are about to make: `middleware.ts` became `proxy.ts`, Turbopack is
the default, `next/root-params` arrived in 16.3, and Babel config is picked up
automatically. Worth a proper read of the upgrade guide before the i18n choice,
not after — two of the candidates configure themselves differently on either side
of that line.

## Visual design and motion
Last, once the product works. Density, colour-as-data, keyboard rules, and
animation only where it explains something. Until then shadcn's defaults, which
are good enough to run a hotel and cheap to replace.
