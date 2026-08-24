---
name: guard-tests
description: Write or modify a Weekloom guard test — a source-scan that reads files as text to prove something stays ABSENT from the codebase, such as no cloud imports, no AI provider, no node:sqlite outside lib/db, no control bytes, or a packaging property. Use when adding or editing anything under tests/, writing a check that asserts an absence, or when a guard test fails and you are tempted to relax it.
---

# Guard tests in Weekloom

`components/**` and `electron/**` are invisible to `npm test`. When behaviour must stay **absent**
from a file, the way this repository proves it is a test that reads the file as **text** rather
than executing it. `tests/no-cloud-imports.test.ts` is the worked example; `no-ai-provider`,
`no-control-bytes`, `electron-shell-safety`, `origin-day-offset` and `packaging-completeness`
follow the same shape.

## First, the principle

**A check that cannot distinguish "passed" from "did not run" is not a check.** This has been the
most expensive class of mistake in this repository, and every instance looked like success:

- A security regex written with **literal control bytes** made its file binary, so `grep` silently
  skipped it, and a reviewer correctly concluded from the available evidence that the check was
  missing. The control _behaved_; it just could not be _audited_.
- A sweep used `grep -P`, which BSD grep rejects. Every invocation errored, the `&&` never fired,
  and the loop printed nothing — indistinguishable from clean.
- A guard asserting an identifier was still present used `String.includes`. Renaming
  `setWindowOpenHandler` to `setWindowOpenHandlerX` left it **green**, because the old name is a
  substring of the new one.
- A criterion written as `grep -E "a\|b"` used an **escaped** pipe, which in an ERE is a literal
  `|`. MEASURED: the escaped form returned 0 lines where the plain-pipe form returned 310.
- An audit compared **counts** — 51 files against 51 ledger rows — and called it verified. Three
  rows and three files were wrong in offsetting directions. **The set difference is the check; the
  count is not.**
- A mutation test whose edit **failed to apply** produced a run against unmutated code that
  reported 5 passed. Every mutation must `assert` before it edits.

Behaviour announces itself when it breaks. **Auditability only fails at the moment somebody goes
looking — which is usually the moment you most need it to hold.** Prefer a command that **errors**
over one that skips; a green skip is the same failure wearing a different hat.

## The source-scan idiom — copy it exactly

1. **Enumerate with `git ls-files --cached --others --exclude-standard`.** ⚠️ `--others` includes
   **untracked** files — the window in which a regression is authored is the window before it is
   staged, and a guard that reads only tracked files is asleep for exactly that window. Then
   `.filter(existsSync)`, because `--cached` still lists files a change has deleted.
2. **Identifier-boundary matching, never `String.includes`.** MEASURED:
   `"blockKey".includes("lockKey")` is `true`.
3. **Extract module specifiers STRUCTURALLY**, not by substring, so a banned bare name can never
   match a longer package that merely starts with it.
4. **Coverage by SET MEMBERSHIP, not by count** — a floor _and_ named files, one from each scanned
   root. An empty scan passes every absence check, and three wrong files cancel out in a total.
5. **A positive control** that the detector fires on a token known to be present.
6. **A negative control** that it does not over-fire on a near miss.
7. **Enumerate rather than blocklist** where the set is closed. The runtime dependency list is
   compared whole, so a _new_ violation fails even though nobody thought of its name. ⚠️ This is
   why adding or removing a dependency requires editing `tests/no-cloud-imports.test.ts` on
   purpose — that failure is the guard working, not an obstacle.
8. **Pure `node:fs`, never shell `grep`**, and **no literal control bytes** in the file.
9. **Record the mutation test in the docstring** — what to break, which named test goes red, and
   plainly which ones were actually executed.

⚠️ **A source-scan guard legitimately contains the tokens it hunts for, so it excludes `*.test.ts`
— including itself.** That exclusion is the guard, not a hole. If one flags its own vocabulary, fix
the exclusion; shrinking the token lists deletes the only durable statement of the property.

## The guards that exist, and what each protects

| test                             | the property                                                                                                                                                                 |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `no-cloud-imports.test.ts`       | the enumerated runtime dependency list; no third-party host in source; no external origin in the CSP; no `node:sqlite` outside `lib/db/`; `revalidatePath` forbidden by name |
| `no-ai-provider.test.ts`         | no model-provider dependency, import specifier or inference hostname                                                                                                         |
| `no-control-bytes.test.ts`       | no literal control byte makes a source file unauditable                                                                                                                      |
| `electron-shell-safety.test.ts`  | the window loads a loopback URL, never `file://`; `HOSTNAME` is bound to `127.0.0.1` and `0.0.0.0` is absent                                                                 |
| `packaging-completeness.test.ts` | the two `electron-builder.yml` lines whose absence ships a dead installer                                                                                                    |
| `origin-day-offset.test.ts`      | the recurring-series dedup key                                                                                                                                               |

⚠️ **Never delete or weaken one to make something pass.** If a guard fails, either the change is a
deliberate change of what Weekloom is — in which case the README and the guard change with it, on
purpose — or the change is wrong.

## Other testing conventions

- Tests use `it.each` for tables, name the failure mode in the title, and pin **both** directions:
  the thing must happen _and_ the near miss must not.
- **Mutation-test load-bearing lines**: delete the line you believe is essential and confirm a
  **named** test goes red. Assert the edit applied before you trust the run.
- ⚠️ A configuration test can only say the YAML still reads correctly. For anything whose failure
  lives in a built artifact, **launch the artifact** — see the `build-electron-app` skill.
