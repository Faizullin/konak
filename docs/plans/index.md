# Plans

What is still planned. **Guides describe how things are**; these describe what
is not built yet. If a plan and a guide disagree, the plan has shipped and
should have been deleted — see [guides/index.md](../guides/index.md).

A plan is deleted once it ships. What survives is whatever it taught, moved
into a guide.

| Plan | What it fixes |
|---|---|
| [trpc-error-helpers.md](trpc-error-helpers.md) | two duplicated error messages, and two throws with no message at all |
| [form-error-consistency.md](form-error-consistency.md) | `zodError.fieldErrors` is published by the server and read by nobody |
| [router-test-harness.md](router-test-harness.md) | the last-admin guard is the one lockout-critical branch with no test |

Each plan states the evidence it rests on as `file:line`. Check the citation
before acting on it — a plan written against a moved line is worse than no
plan.
