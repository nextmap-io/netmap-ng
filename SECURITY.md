# Security Policy

The Netmap NG maintainers take security seriously. Thank you for helping us
keep the project and its users safe.

## Supported Versions

Security fixes are provided for the latest minor release of Netmap NG. Older
releases may receive fixes on a best-effort basis.

| Version           | Supported          |
| ----------------- | ------------------ |
| latest `main`     | yes                |
| latest tagged `v*`| yes                |
| older releases    | best effort        |

## Reporting a Vulnerability

**Please do not file public GitHub issues for security vulnerabilities.**

Use GitHub's [private security advisory] workflow to report vulnerabilities:

[private security advisory]: https://github.com/nextmap-io/netmap-ng/security/advisories/new

The same entry point is referenced from
[`.github/ISSUE_TEMPLATE/config.yml`](.github/ISSUE_TEMPLATE/config.yml) so
issue authors are redirected there.

When reporting, please include:

- A clear description of the issue and its impact.
- Reproduction steps or a proof-of-concept.
- Affected version(s) / commit SHA.
- Any known mitigations or workarounds.

We will acknowledge your report within **3 business days** and aim to provide
an initial assessment within **7 business days**. Critical issues are
prioritized for same-week mitigation.

## Coordinated Disclosure

We follow a coordinated-disclosure model:

1. Reporter submits a private advisory.
2. Maintainers confirm and triage.
3. A fix is developed in a private fork.
4. A release is prepared and a CVE is requested when applicable.
5. The advisory is published alongside the release.

We are happy to credit reporters in the published advisory unless they prefer
to remain anonymous.

## Scope

In scope:

- The Netmap NG backend (`backend/`) and frontend (`frontend/`) source code.
- The official container images published to
  `ghcr.io/nextmap-io/netmap-ng-backend` and
  `ghcr.io/nextmap-io/netmap-ng-frontend`.
- Default deployment manifests in this repository (`docker-compose*.yml`).

Out of scope:

- Vulnerabilities in third-party dependencies that are already publicly
  known and being tracked by Dependabot.
- Issues that require an attacker who already has admin access on the host.
- Self-XSS, clickjacking on pages without sensitive actions, missing best-
  practice headers without a demonstrated impact, etc.
- Findings against forks, third-party deployments, or modified builds.

## Severity Guidelines (CVSS v3.1)

We use CVSS v3.1 base scores as a starting point, then adjust for the actual
deployment model (multi-tenant SaaS vs. self-hosted NOC tool):

| Severity | CVSS Score | Examples |
| -------- | ---------- | -------- |
| Critical | 9.0 – 10.0 | RCE, auth bypass, leaking another tenant's data |
| High     | 7.0 – 8.9  | Privilege escalation, leaking sensitive Observium data via public API |
| Medium   | 4.0 – 6.9  | Stored XSS in editor view, CSRF on state-changing endpoints |
| Low      | 0.1 – 3.9  | Information disclosure with low impact, minor misconfigurations |

The scoring decision rests with the maintainers and is documented in the
published advisory.

## Hardening Reference

For background on the controls already in place (auth guards, public-API
data filtering, RRD path validation, container hardening), see the
"Security" section of [`CLAUDE.md`](CLAUDE.md).
