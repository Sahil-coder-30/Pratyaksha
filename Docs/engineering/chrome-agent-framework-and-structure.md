# Chrome Browser Agent: Framework and Production Structure

**Research date:** 10 October 2026  
**Project:** PRATYAKSHA

## Recommendation

Build the extension with **WXT + TypeScript + Vite**, with React limited to the Side Panel and Options UI if the UI complexity justifies it. Keep the task runner, policies, schemas, privacy boundary, DOM snapshot model, and action contracts as framework-independent TypeScript modules. Use Vitest for unit tests and Playwright or Puppeteer for a small set of extension-loaded end-to-end flows.

WXT is the best match here because the project needs several distinct extension contexts, a real bundle/build pipeline, an MV3 Side Panel, room to grow toward Firefox, and testable extension API boundaries. WXT discovers purpose-specific entrypoints and builds the manifest; it supports a Side Panel entrypoint and has unit-test helpers that provide an in-memory browser API. Its generated manifest is not a reason to hide permissions: keep the manifest configuration centralized and review the generated production manifest on every release. WXT entrypoints must remain shallow (one level under `entrypoints/`), so use that directory only for browser entrypoints, not as the whole application source tree.

**Runner-up:** CRXJS + Vite if a source `manifest.json` is a hard requirement or the team prefers to own every entrypoint explicitly. **Plasmo** is viable for a React-first team that values its integrated conventions, storage and messaging helpers; it abstracts the manifest and the default project organization is flatter. The current prototype is vanilla JS, but it already has no build system, so adopting TypeScript and a real build now is less costly than introducing it after more runtime code accumulates.

The framework handles packaging, entrypoint discovery, reload, and build tooling. It is not an agent framework. Do not select LangGraph, an LLM SDK, or a UI framework as the core architecture. Start with a small typed task state machine and a provider interface; add a graph library only if branching, resumability, or human-approval flows become difficult to manage with explicit code.

## What the market and public implementations show

There is no single canonical “browser agent extension” stack. Current public examples converge on a few runtime boundaries:

1. **Side Panel for the durable user session.** Chat/task input, progress, approval controls, and results live here.
2. **Background service worker for event handling.** It handles install, tab lifecycle, permissions, and message routing; it must tolerate suspension and restart.
3. **Content script for page-local work.** It reads a bounded page representation and executes a narrow action vocabulary.
4. **Agent/tool loop and provider adapters.** Smaller projects place these in the worker; scalable designs isolate them from Chrome APIs and make the active task owner explicit.
5. **Shared protocol and permissions policy.** Messages between extension contexts need schemas, request IDs, versioning, origin/tab checks, and a clear authorization policy.

Examples reviewed:

- [WebBrain](https://github.com/webbrain-one/webbrain) is a multi-browser side-panel agent with task modes and a Chrome/Firefox source split. It illustrates a fuller product surface and an extension build artifact.
- [OpenSidekick](https://github.com/esterhuizen/opensidekick) publishes a compact MV3 layout: shared constants; background worker, agent, providers, tools, permissions, storage; content script; Side Panel; Options. Its documented loop confirms the practical Side Panel → agent/tool boundary → content-script read/act pattern.
- [open-browser-use](https://github.com/open-browser-use/open-browser-use) is a larger local-first system that separates the extension from shared browser-control protocol, SDK, broker, and CLI packages. That is a useful later-stage pattern if PRATYAKSHA adds a native host or external agent clients; it is more infrastructure than this repository needs initially.
- [Browser Use](https://github.com/browser-use/browser-use) is useful as an agent design reference, but it is primarily a Python/browser-automation system rather than a Chrome extension framework. Its repository should not be copied as an extension template.

These are architectural examples, not proof that a given implementation is secure, reliable, or production-ready. Borrow boundaries and inspect implementation/license/security posture before adopting code.

## Framework comparison

| Option | Strengths | Costs / risks | Fit for PRATYAKSHA |
|---|---|---|---|
| **WXT (recommended)** | Vite-based; TypeScript; file-discovered entrypoints; Chrome/Firefox targeting; Side Panel entrypoint; Vitest helpers and fake browser | Generated manifest; entrypoint loader has build-time constraints; avoid extension API calls at module top level | Best balance of scalable structure and extension-specific tooling |
| **CRXJS + Vite** | Manifest-first; close to Vite; precise control over extension entrypoints and output | More wiring and testing setup owned by the project; some content-script bundling constraints need attention | Best when transparent source manifest/control outweighs WXT conventions |
| **Plasmo** | React/TypeScript conventions; built-in messaging/storage concepts; fast UI iteration | More framework abstraction; generated manifest; opinionated file conventions and framework-specific APIs | Good for React-first teams; not my first choice for a security-sensitive agent whose boundaries should stay explicit |
| **Raw MV3 + TypeScript bundler** | Maximum control, minimal framework lock-in | Team owns reload, entrypoint/build configuration, manifest generation, browser compatibility, and test harness | Not recommended for this repository because build/release/test plumbing is still absent |

Official references: [WXT entrypoints](https://wxt.dev/guide/essentials/entrypoints), [WXT manifest config](https://wxt.dev/guide/essentials/config/manifest), [WXT unit testing](https://wxt.dev/guide/essentials/unit-testing), [CRXJS](https://crxjs.dev/guide/installation/from-scratch/), [Plasmo framework](https://docs.plasmo.com/framework), [Plasmo messaging](https://docs.plasmo.com/framework/messaging).

## Proposed source tree

This is a target structure, not a claim about files already implemented. Keep documentation/demo content separate from the extension build. Start as a single extension package; introduce a monorepo only when a native host, backend, shared SDK, or separate web app actually exists.

```text
.
├── apps/
│   └── extension/                         # WXT extension package
│       ├── entrypoints/                   # Only browser entrypoints; keep 0–1 level deep
│       │   ├── background.ts              # MV3 worker bootstrap; register listeners synchronously
│       │   ├── sidepanel/
│       │   │   ├── index.html
│       │   │   ├── main.tsx
│       │   │   └── style.css
│       │   ├── popup/
│       │   │   ├── index.html
│       │   │   └── main.tsx
│       │   ├── options/
│       │   │   ├── index.html
│       │   │   └── main.tsx
│       │   └── agent.content/
│       │       └── index.ts               # Thin bootstrap into page adapter
│       ├── public/
│       │   └── icons/
│       ├── src/
│       │   ├── app/                       # UI composition, routes, app-level state
│       │   ├── features/
│       │   │   ├── tasks/                 # Task start/stop/resume UI and use cases
│       │   │   ├── approvals/             # Review cards and approval decisions
│       │   │   └── settings/              # Provider/model/privacy settings
│       │   ├── runtime/
│       │   │   ├── task-runner.ts         # Explicit observe→decide→validate→act→verify loop
│       │   │   ├── task-state.ts          # State types, transitions, budgets, abort lifecycle
│       │   │   ├── planner.ts             # Deterministic first; optional bounded LLM planning
│       │   │   ├── recovery.ts            # Typed failure and bounded recovery decisions
│       │   │   └── verifier.ts            # Postconditions and completion evidence
│       │   ├── perception/
│       │   │   ├── dom-snapshot.ts        # Small, versioned, privacy-filtered page snapshot
│       │   │   ├── candidate-ranker.ts    # Local candidate matching/scoring
│       │   │   └── snapshot-revision.ts   # Navigation/mutation invalidation
│       │   ├── actions/
│       │   │   ├── action-schema.ts       # Canonical allowlisted action union
│       │   │   ├── action-validator.ts    # Preconditions, target freshness, risk gates
│       │   │   ├── browser-client.ts      # Browser tabs/navigation/capture facade
│       │   │   └── page-client.ts         # Typed request/response facade to content script
│       │   ├── providers/
│       │   │   ├── provider.ts            # Provider-neutral request/response interface
│       │   │   ├── openai.ts              # Optional adapter
│       │   │   └── local.ts               # Optional local inference adapter
│       │   ├── privacy/
│       │   │   ├── egress-gate.ts         # Sole gate for optional external reasoning payloads
│       │   │   ├── redaction.ts           # Local sanitization and policy
│       │   │   └── pii-vault.ts           # Task-scoped transient token mapping
│       │   ├── permissions/
│       │   │   ├── permission-policy.ts   # Least privilege and per-origin grants
│       │   │   └── risk-policy.ts         # Confirmations for high-impact actions
│       │   ├── messaging/
│       │   │   ├── protocol.ts            # Discriminated unions, version, request IDs
│       │   │   ├── background-handlers.ts
│       │   │   └── content-handlers.ts
│       │   ├── content/
│       │   │   ├── page-reader.ts         # Read-only semantic/interactive snapshot
│       │   │   ├── page-actuator.ts       # Typed click/type/select/scroll operations
│       │   │   ├── wait-for-change.ts     # Mutation/navigation waits with timeout/abort
│       │   │   └── overlay/               # Optional page markers, isolated from page data
│       │   ├── storage/
│       │   │   ├── session-store.ts       # Minimal resumable checkpoint
│       │   │   ├── settings-store.ts
│       │   │   └── migrations.ts
│       │   └── observability/
│       │       ├── trace.ts               # Redacted structured trace
│       │       └── metrics.ts              # Stage latency/outcome counters
│       ├── tests/
│       │   ├── unit/
│       │   ├── integration/
│       │   └── e2e/
│       ├── wxt.config.ts                  # Manifest, permissions, target browsers
│       ├── tsconfig.json
│       └── package.json
├── packages/
│   └── contracts/                         # Extract only when another app/process consumes it
├── demo/                                  # Local controlled web pages for agent scenarios
├── documents/                             # Architecture decisions, threat model, roadmap
├── Docs/                                  # Existing public documentation site
├── package.json                           # Workspace scripts
└── pnpm-workspace.yaml                    # Add with package split, otherwise npm is sufficient
```

### Dependency direction

`entrypoints → app/use cases → runtime/domain → provider/browser/content adapters`

The domain/runtime may depend on interfaces and schemas, but not on `chrome.*`, React, WXT imports, DOM globals, or a vendor model SDK. Extension entrypoints wire concrete adapters into those interfaces. Content scripts own the page DOM and only accept validated protocol messages. This makes task logic testable without Chrome and makes provider changes local to adapters.

## Runtime and trust boundaries

### Context ownership

- **Side Panel:** owns the active interactive task while open, cancellation, user approvals, and live progress. This avoids making a short-lived worker the sole owner of a long-running interaction.
- **Background service worker:** registers all listeners at top level; routes requests, tabs, permissions, and one-shot extension events. It is restartable infrastructure, not the source of truth for task memory.
- **Content script:** page-local read/act adapter. It does not call model providers, own API keys, or accept arbitrary JavaScript from the planner.
- **Optional offscreen document / worker:** add only if a concrete API or sustained local compute requires DOM/WebGPU/audio/document APIs unavailable in the service worker. It needs a defined owner, lifecycle, and message contract.

Chrome documents that MV3 workers can be stopped after inactivity and that global in-memory state is lost; persist only a minimal checkpoint in `chrome.storage.session` or IndexedDB and reacquire the live page snapshot after restart. Never persist raw page snapshots or the PII mapping vault for convenience. [Service-worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle), [service-worker migration](https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers).

### Agent loop contract

Use one canonical lifecycle for all modes:

```text
user goal
  → observe bounded page snapshot
  → deterministic match / optional model proposal
  → validate target, schema, origin, freshness, and risk
  → execute one typed action
  → wait for observable change
  → verify task-specific postcondition
  → continue, recover within budget, ask approval, or stop
```

The model may propose; deterministic code validates and authorizes. Target references are ephemeral to one snapshot revision and re-resolved immediately before acting. Completion requires evidence (URL, visible confirmation, state transition, or task-specific predicate), not merely a dispatched click. Start with these actions: `click`, `type`, `select`, `scroll`, `navigate`, `readSnapshot`, and `finish`. Do not ship a general `execute_js` action. Use explicit retry, action-count, provider-call, and wall-clock budgets.

### Security and privacy rules that shape the tree

- Start with `activeTab` and user-triggered injection where the product interaction permits it. Avoid `<all_urls>` / broad host permissions until a feature proves they are necessary. Host permissions are product UX and security decisions, not framework defaults. Chrome describes `activeTab` as temporary access following a user gesture: [activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab).
- Put all permission declarations in one reviewable manifest config and keep a permission-to-feature table in source control.
- Validate every message at the receiving boundary; include protocol version, request ID, tab ID, origin, action type, payload size limit, and timeout/abort semantics.
- Treat all page text as untrusted prompt content. Page text can inform the goal but cannot change policy, permissions, provider config, or action allowlists.
- Route every optional outbound model request through one egress gate. Define exactly which fields can leave the browser; strip credentials, form values, hidden content, irrelevant DOM, and raw screenshots unless explicitly authorized by policy/user.
- Keep API credentials out of source, the packaged extension, and `chrome.storage.sync`. A public extension cannot securely hide a shipped provider key; use a user-supplied key stored locally or a backend that authenticates users and enforces quotas.
- MV3 forbids remotely hosted executable JavaScript/WASM. Bundle executable code and model runtimes. A remote model API is a data service, not permission to download and execute code. [Chrome remote-hosted-code guidance](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code).
- Treat DOM automation limits honestly: closed shadow roots, cross-origin frames, browser-internal pages, PDFs, and canvas-only applications may be unavailable or require separate, explicit capabilities.

## Pressure test: design failures to plan against

| Failure case | What breaks in a naive design | Required design response |
|---|---|---|
| Worker is suspended mid-task | Global state, timers, or a promise chain disappear | Side Panel owns active interaction; persist only resumable task metadata; restore listeners synchronously |
| SPA rerenders after target selection | Stored node/ref points to an old node or a different target | Snapshot revision + immediate semantic re-resolution + stale-target error |
| Model emits an unknown action or fabricated element ID | Arbitrary or wrong page action executes | Strict discriminated union, candidate-bound IDs, schema validation, no dynamic code execution |
| Page includes prompt injection | Agent treats hostile text as instructions | Page content is data only; policy/tool allowlist cannot be changed by page content; confirm risky actions |
| A button dispatches but operation fails | Agent reports success without result | Wait on condition and verify task-specific postcondition; bounded recovery and truthful stop reason |
| LLM/provider is slow, offline, or rate-limited | UI hangs and task burns unbounded time | Deadline, abort, request budget, deterministic fast path, ask/stop fallback |
| PII appears in DOM, screenshot, exception, or trace | Data bypasses text-only redaction | Centralized egress gate plus redacted-by-default logs; keep raw observations local |
| Broad host access is rejected or alarms users | Install friction/store-review risk and wider compromise blast radius | `activeTab`/optional host grants and per-origin permission request when feasible |
| OCR/vision model code is fetched remotely | MV3 store policy violation | Ship audited bundles/assets, or keep inference server-side and send only permitted data |
| Extension panel closes/reloads or browser updates | Active task disappears without explanation | Persist minimal checkpoint; show interrupted state; user explicitly resumes or cancels |

## Reviewed and reconstructed delivery plan

This is sequenced to retire the largest structural risk first, then add capabilities behind tested interfaces.

### Phase 0 — Freeze the product boundary

1. Confirm v1 is a DOM-first Chrome Side Panel agent with optional model reasoning; vision/OCR is later scope.
2. Define supported tasks and success evidence, risk levels, user approval points, local-only fields, provider egress rules, minimum Chrome version, and whether Firefox is a real near-term target.
3. Correct docs that describe unimplemented OCR/YOLO/BERT/WebGPU/microservices as current runtime. Label them as proposal/roadmap.

### Phase 1 — Build foundation

1. Create a WXT TypeScript package and check in generated-manifest review instructions.
2. Migrate `manifest.json` permissions intentionally; start narrow and ensure the production build output contains no development-only permissions or remote executable code.
3. Establish shared action/message/result/error schemas and API facades before moving agent logic.
4. Add lint/typecheck/build and unit-test commands; use unit tests for pure policy/state/schema logic, and extension-loaded E2E for a short core flow.

### Phase 2 — Consolidate runtime

1. Replace sidepanel-owned ad hoc construction and the separate planner/graph paths with one TaskRunner interface.
2. Put page reading and page actions behind the content adapter; remove broad JavaScript execution.
3. Add snapshot revisions, target re-resolution, typed errors, postconditions, cancellation, retry limits, and task deadlines.
4. Put provider-specific transport behind an adapter and all payloads behind the egress gate.

### Phase 3 — Harden and measure

1. Implement the failure matrix as deterministic test fixtures and test service-worker restart/recovery behavior.
2. Add risk-based approval for navigation, submission, deletion, payment/account changes, and sensitive domains.
3. Measure task completion, action correctness, stale-target rate, permission-denied outcomes, provider p50/p95, token/context size, task cancellation, and recovery success on a fixed scenario set.
4. Only after baseline: add richer site adapters, more providers, vision, OCR, local models, native messaging, or external SDK packages.

### Phase 4 — Scale architecture only on evidence

Split `packages/contracts` when a second application/process needs the protocol. Add a backend only for concrete needs such as account auth, model proxying, quotas, synchronized settings, or opt-in analytics. Do not introduce microservices to solve an extension-local module organization problem.

## Acceptance gates before calling this production-ready

- Production build works from a clean checkout and emits a loadable MV3 directory.
- Generated manifest is reviewed; every permission maps to a user-facing feature; no broad host permissions without a documented need.
- No shipped secrets, arbitrary model-authored JavaScript, remote executable code, or raw page-content telemetry.
- Typed message contracts and action allowlist are enforced on both sides of every boundary.
- Worker restart, page navigation, SPA rerender, stale target, provider timeout, permission denial, prompt injection, and failed postcondition have defined outcomes.
- User can stop a task promptly, see whether a mutation is about to happen, and see evidence for a reported completion.
- A fixed task suite reports task success and safety failures separately; latency and privacy claims are based on measurements, not aspirational documentation.

## Repository-specific conclusion

The current repository is a static docs/demo site plus a small vanilla-JavaScript extension, with no package workspace or extension bundler. Existing `graph-engine.js`, `planner.js`, and `browser-tools.js` are the initial migration inputs, not the future architecture boundaries. The existing `documents/production-dom-agent-architecture.md` already correctly advises a DOM-first bounded task loop and identifies issues such as duplicated planners, arbitrary JS, stale numeric targets, weak completion evidence, and incomplete egress filtering; this proposal turns those concerns into an implementation layout and framework decision.

Recommended first technical milestone: scaffold the WXT package in `apps/extension`, import the current extension only after defining the shared protocol and action schemas, and retain `Docs/` and `demo/` as top-level documentation/test content. Do not move the complete existing `pratyaksha-extension/` tree wholesale into WXT: first split runtime responsibilities so the old coupling does not become the new package's permanent structure.

## Sources

- WXT: [entrypoints](https://wxt.dev/guide/essentials/entrypoints), [manifest](https://wxt.dev/guide/essentials/config/manifest), [unit testing](https://wxt.dev/guide/essentials/unit-testing), [extension API entrypoint constraints](https://wxt.dev/guide/essentials/extension-apis)
- CRXJS: [getting started](https://crxjs.dev/guide/installation/from-scratch/), [content scripts](https://crxjs.dev/concepts/content/)
- Plasmo: [framework](https://docs.plasmo.com/framework), [messaging](https://docs.plasmo.com/framework/messaging)
- Chrome for Developers: [service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle), [service worker migration](https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers), [activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab), [remote hosted code](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code), [extension E2E testing](https://developer.chrome.com/docs/extensions/how-to/test/end-to-end-testing)
- Open implementations reviewed: [WebBrain](https://github.com/webbrain-one/webbrain), [OpenSidekick](https://github.com/esterhuizen/opensidekick), [open-browser-use](https://github.com/open-browser-use/open-browser-use), [Browser Use](https://github.com/browser-use/browser-use)
