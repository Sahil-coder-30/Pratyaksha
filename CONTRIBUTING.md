# Contributing to Pratyaksha

Thanks for helping. This guide keeps changes easy to review.

## Setup

Follow the [Quick start](README.md#quick-start) in the README. You need Node.js 22+, pnpm, Python 3.12+ and uv.

## Workflow

1. Fork the repo and create a branch from `main`, for example `feat/tab-groups` or `fix/vault-origin`.
2. Keep each pull request focused on one change.
3. Run the checks below before you push.
4. Open a pull request that says what changed and why.

## Checks

```bash
pnpm typecheck
pnpm --filter @bigfish/server test
pnpm --filter @bigfish/extension test
uv --project ML run pytest ML/tests
```

## Code rules

| Rule | Detail |
|---|---|
| Shared types | Tool schemas and wire types live in `packages/contracts`. Change them there, not in each app. |
| Privacy first | Never send raw page text, screenshots or personal values to the server or a model. Mask them in the extension. |
| Fail closed | If a safety step cannot run, refuse the action instead of skipping the step. |
| Tests | Add a test for new logic, especially in `safety/`, `agent/` and `ML/src/privacy/`. |
| Secrets | Never commit `.env` files, keys or `.pem` files. |

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`.

## Security issues

Do not open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md).
