# Security Policy

## Supported versions

Scaffold Day is in pre-release. Only the latest tagged release on the
`main` branch receives security fixes. Older versions are not supported.

| Version       | Supported |
| ------------- | --------- |
| `main` (HEAD) | ✅        |
| `< 0.1.0`     | ❌        |

Once `v0.1.0` ships we will revisit this policy.

## Reporting a vulnerability

**Please do not file public GitHub issues for security vulnerabilities.**

Use one of the following private channels:

1. **Preferred** — GitHub private vulnerability reporting:
   `https://github.com/scaffold-at/day/security/advisories/new`
2. **Email** — `security@scaffold.at` with subject prefix
   `[scaffold-day]`. PGP key available on request.

Please include:

- Affected version (`scaffold-day --version`) or commit SHA
- A clear description of the vulnerability and its impact
- Step-by-step reproduction (proof of concept welcome)
- Any suggested fix or mitigation

## Response SLA

| Class                         | Target first response |
| ----------------------------- | --------------------- |
| Active exploitation / data loss | 24 hours             |
| Confirmed vulnerability        | 48 hours             |
| Hardening / non-exploitable    | 1 week               |

We will confirm receipt, agree on a coordinated disclosure timeline
(typically 30–90 days), and credit the reporter in the release notes
unless anonymity is requested.

## Scope

In scope:

- The `scaffold-day` CLI binary and all packages in this repository
- The Google Calendar adapter (OAuth handling, token storage)
- The MCP server surface
- Anything that could leak local user data (TODOs, calendar events,
  OAuth tokens) outside the user's machine

Out of scope:

- Vulnerabilities in dependencies that have already been disclosed and
  for which an upgrade is available — please open a normal issue/PR
- Issues requiring a pre-compromised host (e.g., a malicious local
  process already running as the user)
- Social engineering of maintainers
- The `scaffold.at` website itself (report to `security@scaffold.at`
  with a different subject prefix)

## Safe harbor

Good-faith security research conducted within this scope will not
result in legal action from the project maintainers. Please act in
good faith, avoid privacy violations and service disruption, and give
us a reasonable chance to fix the issue before public disclosure.
