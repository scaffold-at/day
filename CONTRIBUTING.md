# Contributing to Scaffold Day

Thanks for your interest in Scaffold Day. This document covers the legal
and procedural ground rules for contributing.

> Scaffold Day is an AGPL-3.0-or-later open source project. Read the
> [LICENSE](./LICENSE) and [NOTICE](./NOTICE) files first.

---

## TL;DR

1. **Sign your commits** with `git commit -s` (DCO — see below).
2. **No CLA.** You retain copyright; you only certify the DCO.
3. **License covenant**: re-licensing, if it ever happens, will only move
   toward a *more permissive* license. Never more restrictive.
4. Open issues and pull requests at
   `https://github.com/scaffold-at/day` (canonical repository).

---

## Developer Certificate of Origin (DCO)

We use the [Developer Certificate of Origin v1.1](https://developercertificate.org/)
to track provenance of contributions. There is **no Contributor License
Agreement (CLA)**.

By signing off on a commit, you certify the following:

```
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.
1 Letterman Drive
Suite D4700
San Francisco, CA, 94129

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.


Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```

### How to sign off

Append `Signed-off-by: Your Name <your.email@example.com>` to every
commit. The easiest way is the `-s` flag:

```sh
git commit -s -m "Add foo"
```

The trailer must match the author/committer email. CI rejects PRs whose
commits are missing or have malformed sign-offs.

---

## Licensing covenant: permissive-only re-licensing

Scaffold Day is licensed under **AGPL-3.0-or-later**. The maintainers
commit, as a condition of accepting your contributions, that:

> Any future re-licensing of Scaffold Day will only be made toward a
> *more permissive* license (e.g., Apache-2.0, MIT, BSD). The license
> will never be changed in a more restrictive direction. Proprietary
> re-licensing of the canonical project is off the table.

This commitment exists to make contributing safe: you do not have to
worry that your AGPL contribution will later be repackaged under a more
restrictive proprietary license. If we ever loosen the license, your
contribution gets the benefit too.

This is also the reason we do **not** require a CLA — we have nothing
we want to do with your code that AGPL does not already permit.

---

## How to contribute

### Reporting bugs

Open a GitHub Issue. Include:

- `scaffold-day --version`
- OS / arch
- Minimal reproduction
- Output of `scaffold-day doctor` if relevant
- For data corruption issues, output of `scaffold-day diag bundle --redact`
  (do NOT post unredacted bundles publicly)

### Proposing features

For non-trivial features, open a GitHub Discussion in the **Ideas**
category before sending a PR. Scaffold Day's MVP scope is intentionally
narrow (see [SLICES.md](https://github.com/scaffold-at/day-blueprint)
in the design repository); features outside the v0.1 plan may need to
wait for v0.2+.

### Pull requests

1. Fork and create a feature branch off `main`.
2. Make focused commits, each with a `Signed-off-by` trailer.
3. Run `bun typecheck` and `bun test` locally before pushing.
4. PR description should reference the relevant slice (`S##`) when
   applicable.
5. CI gates: lint, typecheck, test, token-budget regression, DCO check.
6. Maintainer review may take up to 1 week per the project SLA.

### Commit message style

```
<area>: <imperative summary>

Optional body explaining why, not what.

Closes #123

Signed-off-by: Your Name <you@example.com>
```

Areas: `cli`, `core`, `mcp`, `adapters`, `docs`, `ci`, etc.

---

## Code of conduct

Participation in this project is governed by the
[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md). Report unacceptable behavior
to the maintainer (see CODE_OF_CONDUCT for contact).

---

## Security issues

**Do not file public issues for security vulnerabilities.** See
[SECURITY.md](./SECURITY.md) for the private reporting channel.

---

## Korean / 한국어

한국어 기여 안내는 v0.1 출시 후 `CONTRIBUTING.ko.md`로 추가됩니다.
그전에는 이 문서를 영문으로 따라 주세요. 이슈·PR 본문은 한국어/영어 모두
환영합니다.
