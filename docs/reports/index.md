# Reports

Deliverables. A report here is **generated** — a script drives the real app,
photographs it, and writes the document — so the `.md` files in this folder are
outputs and are not edited by hand. What is edited is the prose in `src/`.

| File | What it is |
|---|---|
| [mvp-report.ru.md](mvp-report.ru.md) | the client's report, in Russian: their eight MVP items, the screen each lives on, and what is deliberately not there |
| [src/mvp-report.ru.md](src/mvp-report.ru.md) | the prose behind it. **Edit this one.** `{{shot:…}}` marks where a picture goes |
| `screens/` | the pictures |

```bash
npm run report:mvp    # database, browser, screenshots, document
```

## The screens folder holds two kinds of file

| Name | Who writes it |
|---|---|
| `gen-*.png` | the script, and only the script — it deletes the set and takes it again on every run |
| anything else | a person. Never touched |

So a photograph of the real lobby, or a shot somebody cropped by hand, can sit
beside the generated ones without a run destroying it — and a step removed from
the manifest cannot leave a stale picture behind.

## Why this folder is committed and `/reports` is not

They are different things. `/reports` is what `npm run report:ui` produces:
every screen, both languages, both colour schemes, a PDF, megabytes per run —
a run's output, and git-ignored so a PNG diff never becomes part of code review.

This is one curated document in one language, and **a document whose images are
not in the repository is not a document**. The budget that keeps it honest: one
locale, one colour scheme, at most sixteen shots, under 2 MB for the folder.

`guides/index.md` § The screenshot report is the rule, and says the same.
