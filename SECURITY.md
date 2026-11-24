# Security Policy

Pratyaksha controls a real browser with real logins, so security reports matter a lot.

## Reporting a vulnerability

Please **do not** open a public issue.

Report it privately through [GitHub Security Advisories](https://github.com/Sahil-coder-30/Pratyaksha/security/advisories/new).

Include:

- What is affected (extension, server, ML daemon, or a package)
- Steps to reproduce
- The impact you expect

You should get a first reply within 7 days.

## Scope

In scope:

- Personal data leaving the browser without masking
- Vault tokens restored on the wrong origin
- Risky actions that skip the approval prompt
- Auth bypass on `/api/*` or `/mcp-ws`
- Prompt injection that makes the agent act against the user

Out of scope:

- Issues that need a compromised local machine
- Running with `ENABLE_DEV_ROUTES=1`, which is for local development only

## Supported versions

Only the latest `main` branch gets security fixes.
