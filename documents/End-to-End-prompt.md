# MASTER IMPLEMENTATION PROMPT
# PRATYAKSHA — Complete LangChain + LangGraph Agentic Browser Automation System

## 1. YOUR ROLE

You are the principal software architect and implementation engineer responsible for transforming the existing PRATYAKSHA Chrome Extension into a complete, reliable, privacy-first, agentic browser automation system using LangChain and LangGraph.

You have access to the existing repository.

Your job is to:

1. Analyze the entire existing codebase.
2. Understand the current browser automation architecture and execution flow.
3. Identify reusable components, bugs, security risks, and architectural limitations.
4. Design the target architecture based on the actual repository.
5. Create the proposed directory structure without breaking existing functionality.
6. Implement the architecture incrementally, file by file, in clearly separated chunks.
7. Test each chunk before moving to the next.
8. Integrate all components into one working system.
9. Run comprehensive tests and fix integration failures.
10. Produce a final implementation report describing what works, what was changed, and what remains unverified.

Do not merely explain how the system should be implemented.

**You must perform the implementation directly in the repository.**

Do not stop after producing an architecture document, a file plan, or sample code.

Continue through all implementation phases unless a genuine blocker requires user intervention.

Do not ask for confirmation after every phase. Make reasonable engineering decisions, document them, and continue.

However, never fabricate test results, silently ignore failed tests, or claim that a feature works when it has not been verified.

---

# 2. PROJECT CONTEXT

Project name: PRATYAKSHA

Product vision:

PRATYAKSHA is a sovereign, privacy-first browser automation agent operating inside a Chrome Extension using Manifest V3.

The user gives a natural-language objective.

The system understands the objective, plans the work, observes the current browser page, selects tools, executes browser operations, verifies outcomes, handles recoverable failures, requests human approval for sensitive actions, and returns a structured final result.

The desired implementation uses:

- LangChain chat models.
- LangChain `createAgent()`.
- LangChain tools.
- LangChain middleware where supported.
- LangGraph `StateGraph`.
- LangGraph conditional edges.
- LangGraph checkpoints.
- LangGraph interrupts and resumable human approval.
- Structured model outputs.
- Existing Chrome Extension APIs.
- Existing browser content scripts.
- Existing privacy and PII-vault functionality.
- Existing event and UI integration where appropriate.

The goal is to minimize custom orchestration without compromising browser safety, execution correctness, reliability, or privacy.

Do not attempt to eliminate all application-specific code.

Chrome APIs, browser-specific action policies, verification criteria, privacy handling, persistence adapters, and extension lifecycle management may require custom code.

Prefer framework capabilities where they genuinely fit.

Do not build custom versions of features already provided reliably by the installed frameworks.

---

# 3. NON-NEGOTIABLE ENGINEERING RULES

Follow these rules throughout the project.

## Rule 1: Inspect before modifying

Before changing any file, inspect the relevant existing implementation and its dependencies.

Do not assume the repository matches the architecture described in this prompt.

The actual codebase is the source of truth.

## Rule 2: Preserve existing functionality

Reuse the existing browser automation engine wherever practical.

Do not rewrite working browser tools merely to make the architecture look cleaner.

Do not delete existing features without establishing that they are obsolete and identifying their replacement.

## Rule 3: Verify installed APIs

Inspect:

- `package.json`.
- Lockfiles.
- Installed package versions.
- Actual package exports.
- Type declarations.
- Official documentation for the installed versions, where available.

Verify every LangChain and LangGraph API before relying on it.

Do not copy outdated examples from blog posts.

Do not assume a middleware exists because it appears in an older example.

Do not invent constructor parameters, imports, callback signatures, or checkpointer interfaces.

If a proposed API is unsupported, use a supported alternative and document the change.

## Rule 4: Work incrementally

Implement the project in chunks.

Each chunk must have:

- A defined objective.
- A list of files to inspect.
- A list of files to create or modify.
- Acceptance criteria.
- Tests.
- A completion report.

Do not implement the entire project in one enormous, unverified edit.

## Rule 5: Keep the repository buildable

After each meaningful chunk:

1. Run relevant tests.
2. Run type checking if configured.
3. Run linting if configured.
4. Run the available build.
5. Fix regressions introduced by your changes.

If an existing unrelated failure prevents a command from passing, document it precisely.

Do not mark a failing check as successful.

## Rule 6: No placeholder implementation

Do not leave core functionality as:

- `TODO`.
- Empty functions.
- Mock implementations used in production paths.
- Hardcoded successful responses.
- Fake checkpoint persistence.
- Fake browser observations.
- Stub verification that always returns success.
- Unsupported middleware imports hidden behind comments.

Mocks are acceptable inside tests, but production code must use real implementations.

## Rule 7: Maintain API and schema consistency

There must be one authoritative definition for browser tool names and argument schemas wherever possible.

Avoid independently maintained, drifting copies of the same tool definitions.

All model-facing tool arguments must be validated.

All tool results must follow a consistent internal contract.

## Rule 8: Preserve user control

Never automatically execute an irreversible action merely because the model requested it.

Do not allow a model-generated success claim to substitute for actual browser-state verification.

Do not retry non-idempotent browser actions blindly.

## Rule 9: Privacy is mandatory

Do not expose API keys, credentials, cookies, tokens, or unnecessary personal information in logs, model prompts, events, error messages, or persistent checkpoints.

Inspect the existing privacy vault before implementing another PII-management system.

Reuse existing privacy mechanisms where appropriate.

## Rule 10: Complete the integration

Do not finish after creating individually correct modules.

The final implementation must connect all modules through the real application execution path.

---

# 4. EXISTING BROWSER TOOL SYSTEM

The repository contains or is expected to contain a browser tool registry similar to the following.

The actual repository must be inspected before making changes.

## Tool declarations

`BROWSER_TOOL_DECLARATIONS` currently defines these tools:

### Navigation and search

- `search_web`
- `open_url`
- `go_back`
- `go_forward`
- `switch_tab`

### Reading and extraction

- `read_page`
- `get_page_metadata`
- `get_links`
- `find_on_page`
- `extract_structured`

### Browser interaction

- `click_element`
- `type_into_element`
- `execute_js`

### Observation and waiting

- `inspect_dom`
- `screenshot`
- `scroll_page`
- `wait_for`
- `wait_seconds`

### Task completion

- `finish_task`

There are 18 tools in this list. Count the actual declarations in the repository rather than trusting previous comments or documentation.

The existing implementation includes:

- `BROWSER_TOOL_DECLARATIONS`.
- `MISTRAL_TOOL_DECLARATIONS`.
- `executeBrowserTool()`.
- `sendToTab()`.
- `waitForTabLoad()`.
- `ensureContentScript()`.
- `sleepMs()`.
- Screenshot storage.
- Chrome tab management.
- Content-script communication.
- DOM interactions.
- A privacy vault integration.

These tools are the foundation of the new agent.

Preserve their existing behavior unless a change is necessary for correctness, security, framework integration, or testing.

---

# 5. TARGET ARCHITECTURE

Implement the following logical architecture, adapting the exact files to the repository.

```text
                         USER TASK
                             |
                             v
                    TASK INTAKE / VALIDATION
                             |
                             v
                       PRIVACY LAYER
                             |
                             v
                       PLANNER NODE
                             |
                             v
                        POLICY NODE
                             |
                 +-----------+-----------+
                 |           |           |
                 v           v           v
              DENIED      APPROVAL     ALLOWED
                 |           |           |
                 |           v           |
                 |       INTERRUPT       |
                 |           |           |
                 |       APPROVED        |
                 |           |           |
                 +-----------+-----------+
                             |
                             v
                     BROWSER AGENT NODE
                             |
                             v
                    LANGCHAIN CREATEAGENT
                             |
                             v
                     MODEL / TOOL LOOP
                             |
                             v
                    EXISTING BROWSER TOOLS
                             |
                             v
                    FRESH BROWSER OBSERVATION
                             |
                             v
                     VERIFICATION NODE
                             |
                +------------+------------+
                |            |            |
                v            v            v
             VERIFIED     RECOVERABLE    BLOCKED
                |          FAILURE         |
                v            |             v
             FINALIZE        v          FINALIZE
                          RECOVERY
                             |
                             v
                           REPLAN
```

Use LangChain for model and tool execution.

Use LangGraph for the outer workflow, including planning, policy evaluation, verification, recovery, and resumable approval.

Do not introduce unnecessary nested agents or graph complexity.

If the repository or installed framework versions make a different graph composition more reliable, document the reason before implementing it.

---

# 6. TARGET PROJECT STRUCTURE

First inspect the current structure.

Then create or adapt a structure similar to this:

```text
src/
├── agent/
│   ├── models.js
│   ├── browser-tools.js
│   ├── state.js
│   ├── planner.js
│   ├── verifier.js
│   ├── recovery.js
│   ├── middleware.js
│   ├── agent.js
│   └── graph.js
│
├── browser/
│   ├── browser-tools.js
│   ├── page-context.js
│   ├── dom-actions.js
│   └── content-main.js
│
├── safety/
│   ├── action-policy.js
│   ├── approval.js
│   ├── url-policy.js
│   ├── privacy.js
│   └── execution-limits.js
│
├── persistence/
│   ├── checkpointer.js
│   └── thread-store.js
│
├── background/
│   └── service-worker.js
│
├── ui/
│   └── agent-events.js
│
└── shared/
    ├── schemas.js
    ├── errors.js
    └── constants.js
```

This is a proposed logical layout, not a requirement to blindly move every file.

Before creating directories:

1. Inspect the current repository.
2. Identify existing equivalents.
3. Map old files to new responsibilities.
4. Avoid duplicate modules.
5. Keep extension entry points compatible with the existing manifest and bundler.
6. Update imports and configuration when files move.
7. Preserve backward compatibility where existing callers depend on current interfaces.

Create `docs/architecture.md` containing the final directory map and module responsibilities.

---

# 7. PHASE 0 — REPOSITORY DISCOVERY

This phase must happen before implementation.

Do not modify production files during initial discovery.

## Tasks

### 7.1 Inspect the complete repository

Read:

- `package.json`.
- Lockfiles.
- `manifest.json`.
- Bundler configuration.
- Existing background/service-worker entry points.
- Content scripts.
- Popup or side-panel UI.
- Existing model/provider integration.
- Existing browser tool declarations.
- Existing tool dispatcher.
- Existing DOM actions.
- Existing privacy vault.
- Existing event system.
- Existing persistence logic.
- Existing tests.
- Existing documentation.

Inspect related files whenever dependencies or execution flow require them.

Do not inspect only the files explicitly named in this prompt.

### 7.2 Map the current execution flow

Determine exactly:

- Where the user task enters the system.
- Where the active tab is selected.
- How model requests are constructed.
- How tool calls are dispatched.
- How browser observations are generated.
- How errors propagate.
- How cancellation works.
- How the UI receives events.
- Where API keys are stored.
- How PII anonymization and rehydration work.
- Whether any existing retry or navigation-recovery logic exists.
- Whether tasks can already be resumed.

### 7.3 Audit dependencies and framework compatibility

Verify:

- Current LangChain version, if installed.
- Current LangGraph version, if installed.
- Provider package versions.
- Whether the application uses ESM or CommonJS.
- Whether the current bundler supports the chosen imports.
- Whether the selected provider integrations support tool calling.
- Whether the proposed middleware APIs exist in the installed versions.
- Whether structured output is supported by the chosen model/provider combination.
- Which checkpointer APIs are available.
- How the extension currently handles package bundling.

Do not upgrade packages automatically just because newer versions exist.

Prefer the smallest compatible dependency change.

### 7.4 Identify current defects

Pay special attention to:

- Incorrect tool counts or stale documentation.
- Invalid or incomplete JSON schemas.
- Silent errors.
- Incorrect navigation-success assumptions.
- Repeated browser actions after timeouts.
- Stale DOM references.
- Tool argument mismatches.
- Unsafe arbitrary JavaScript execution.
- Missing URL restrictions.
- Sensitive information in callbacks.
- Duplicate DOM observations.
- Incorrect model retry behavior.
- Missing cancellation propagation.
- Chrome Manifest V3 service-worker lifecycle problems.
- Incorrect human-approval resume behavior.

### 7.5 Produce the discovery artifacts

Create:

`docs/implementation-audit.md`

Include:

- Existing architecture.
- Current execution flow.
- Reusable modules.
- Defects discovered.
- Dependency compatibility findings.
- Security and privacy findings.
- Required migrations.
- Existing tests and their baseline status.

Create:

`docs/implementation-plan.md`

Include:

- Final target architecture.
- Current-file-to-target-file mapping.
- Implementation phases.
- Dependencies between phases.
- Acceptance criteria.
- Risks and mitigations.

Do not proceed with speculative changes before completing this audit.

Once the artifacts are created, continue to Phase 1 without asking for confirmation unless an actual blocker exists.

---

# 8. PHASE 1 — TOOL REGISTRY AND SHARED CONTRACTS

Objective: establish reliable schemas and shared interfaces before integrating the agent.

## 8.1 Preserve a single authoritative tool registry

Reuse `BROWSER_TOOL_DECLARATIONS`.

Avoid independently defining browser tools in:

- Provider-specific adapters.
- LangChain wrappers.
- System prompts.
- UI components.
- Test fixtures.

Derive provider-specific schemas from the registry when practical.

Derive LangChain tool definitions from the same source where supported.

If framework limitations require separate schema definitions, introduce automated consistency tests.

Do not maintain silently divergent copies.

## 8.2 Normalize schema conversion

The existing registry uses Gemini-style schema types, such as:

```js
{
  type: 'OBJECT',
  properties: {
    query: {
      type: 'STRING'
    }
  },
  required: ['query']
}
```

The current Mistral conversion generates OpenAI-style JSON Schema.

Audit the converter carefully.

Support, where applicable:

- Strings.
- Numbers.
- Integers.
- Booleans.
- Objects.
- Arrays.
- Nested objects.
- Required fields.
- Enums.
- Descriptions.
- Optional properties.
- Nullable values if needed.

Do not blindly lowercase every JSON Schema type without checking its semantics.

Validate nested `required` fields and array-item definitions.

Use the schema format supported by the installed LangChain version.

If Zod is required, generate or define equivalent Zod schemas and test consistency against the authoritative registry.

## 8.3 Establish a standard tool result contract

Define a consistent internal result structure.

Conceptually:

```js
{
  ok: true,
  toolName: 'read_page',
  observation: '...',
  page: {
    url: '...',
    title: '...'
  },
  metadata: {}
}
```

Errors must be represented consistently.

Do not fabricate page state or treat missing responses as success.

Do not expose sensitive implementation details in user-facing errors.

Preserve useful diagnostic information in appropriately redacted internal logs.

## 8.4 Acceptance criteria

- All existing tools are accounted for.
- Every declared tool has a dispatcher implementation or an explicit, documented reason for removal.
- Every dispatcher tool has a valid schema.
- Required arguments are enforced.
- Nested object schemas are validated.
- Provider schema conversion is tested.
- Existing callers remain compatible or are migrated.
- No duplicate authoritative registry is introduced.

Run the relevant tests before continuing.

---

# 9. PHASE 2 — STABILIZE THE BROWSER EXECUTION LAYER

Objective: make existing browser operations reliable before adding autonomous orchestration.

Inspect and improve:

- `executeBrowserTool()`.
- `sendToTab()`.
- `waitForTabLoad()`.
- `ensureContentScript()`.
- Tab-switching behavior.
- Page observation.
- Screenshot capture.
- Browser cancellation.

Do not rewrite the browser engine unnecessarily.

## 9.1 Navigation semantics

Navigation functions must distinguish:

- Successful navigation.
- Navigation timeout.
- Tab closure.
- Restricted browser page.
- Content-script injection failure.
- Unexpected navigation.
- Uncertain action outcome.

A timeout must not automatically be reported as successful navigation.

## 9.2 Content-script communication

Review message-channel handling.

A closed message channel may indicate navigation, but it does not always prove that an operation succeeded.

Verify the current tab state before classifying the result.

Do not retry a potentially non-idempotent operation merely because its response was lost.

Separate safe observation retries from interaction retries.

## 9.3 Tab switching

When `switch_tab` changes the active tab:

- Update the shared session tab ID.
- Collect observations from the new tab.
- Ensure subsequent tool calls use the new tab.
- Avoid returning stale observations from the previous tab.
- Handle tabs that are closed during execution.

## 9.4 DOM snapshots

Establish a single authoritative function for collecting the current page observation.

Ensure that:

- Navigation produces a fresh observation.
- Interaction results are not paired with stale DOM data.
- DOM element IDs are scoped to the relevant page state.
- Stale target IDs are detected when possible.
- Large snapshots are bounded.

## 9.5 `execute_js`

Treat arbitrary JavaScript execution as a privileged capability.

Determine the existing execution context and permissions.

Implement a dedicated policy for:

- Allowed execution contexts.
- Read-only versus mutating operations.
- Sensitive pages.
- Restricted browser origins.
- User approval where required.

Do not assume arbitrary JavaScript can be made safe solely through prompt instructions.

Do not unnecessarily remove existing functionality; secure it according to the actual architecture.

## 9.6 Screenshot handling

The existing screenshot tool returns screenshot data separately from its text observation.

Ensure the result contract can preserve this data without accidentally converting it to an enormous text string.

If screenshot reasoning is supported:

- Use a valid multimodal message format.
- Verify provider image-input support.
- Apply image size limits.
- Protect sensitive visual content.
- Handle unsupported vision models gracefully.

Do not claim the model can see a screenshot unless the image actually reaches the model.

## 9.7 Cancellation

Propagate cancellation signals where supported.

Do not assume that aborting a model request automatically cancels an in-flight Chrome API operation.

Define what happens when cancellation occurs:

- Before an action.
- During a model request.
- During browser navigation.
- During an approval wait.
- During verification.

Do not automatically repeat an interrupted action.

## 9.8 Acceptance criteria

- Browser failures are reported accurately.
- Uncertain action outcomes are represented explicitly.
- Tool retries do not blindly duplicate side effects.
- Tab switching updates shared state correctly.
- Fresh observations correspond to the correct tab.
- Cancellation behavior is documented and tested.
- Existing browser interactions remain functional.

---

# 10. PHASE 3 — LANGCHAIN MODEL FACTORY

Create or adapt:

`src/agent/models.js`

The model factory should support the providers already used by the project.

Expected providers:

- Mistral.
- OpenRouter.
- Google Gemini.

Use the actual installed integrations and supported exports.

## Requirements

### 10.1 Model creation

Expose a single model factory that accepts validated provider configuration.

Conceptually:

```js
makeModel({
  provider,
  model,
  apiKey
});
```

Support provider-specific options only where the installed integration supports them.

### 10.2 Validation

Validate:

- Provider.
- Model ID.
- API key availability.
- Required provider settings.
- Tool-calling compatibility.
- Relevant model capabilities.

Fail early with clear errors for invalid configuration.

### 10.3 Retry ownership

Avoid duplicate retry mechanisms.

If LangChain middleware owns model retries, disable or configure underlying SDK retries accordingly where supported.

Do not disable SDK retries blindly if the installed integration requires them for correct behavior.

Document the actual retry ownership.

### 10.4 Fallbacks

Support configured fallback models in a deterministic order.

Classify failures where practical.

Do not repeatedly retry:

- Invalid credentials.
- Invalid model IDs.
- Missing account credits.
- Unsupported capabilities.

Ensure fallback behavior does not violate privacy constraints or send sensitive context to an unauthorized provider.

### 10.5 OpenRouter catalogue

Inspect existing model catalogue functionality.

Preserve working model-discovery and dropdown behavior.

Do not rewrite model catalogue logic unless necessary.

Verify whether the selected model actually supports the required tool-calling behavior.

### 10.6 Acceptance criteria

- The factory returns valid LangChain chat models.
- Provider-specific configuration is correct.
- Invalid configuration fails clearly.
- Tool calling works for supported models.
- Retry and fallback behavior is tested.
- API keys are not hardcoded or logged.
- The existing UI model-selection workflow still works.

---

# 11. PHASE 4 — LANGCHAIN BROWSER TOOL ADAPTERS

Create or adapt:

`src/agent/browser-tools.js`

The adapter should expose existing browser operations through LangChain tools.

Keep the underlying browser implementation in its authoritative module.

## Requirements

### 11.1 Tool conversion

Convert the authoritative browser tool registry into LangChain-compatible tools.

Validate the schema format required by the installed version.

Do not assume arbitrary JSON Schema objects are accepted by every `tool()` implementation.

### 11.2 Execution

Each LangChain tool should:

1. Validate arguments.
2. Apply relevant tool-level policy.
3. Execute the existing browser dispatcher.
4. Normalize the result.
5. Collect or preserve the appropriate observation.
6. Return a model-compatible result.
7. Propagate errors using supported LangChain conventions.

Do not duplicate the dispatcher implementation inside LangChain wrappers.

### 11.3 Page observations

Ensure model-facing observations provide enough information for the next action.

For interactive actions, return fresh state where appropriate.

For reading tools, preserve extracted content without unnecessarily adding a full DOM snapshot.

For screenshots, preserve multimodal data separately from ordinary text.

### 11.4 `finish_task`

Inspect the current completion tool.

The target architecture should use structured task results and a dedicated verification step.

Remove `finish_task` from model-facing tools if it becomes redundant.

If compatibility requires retaining it temporarily, make it a task-completion signal only, not proof of verified success.

Do not allow the model to bypass verification.

### 11.5 Acceptance criteria

- LangChain can invoke the existing browser tools.
- Argument validation works.
- Errors are surfaced correctly.
- Observations remain associated with the correct browser tab.
- Tool names and schemas remain consistent.
- Existing browser code is reused rather than duplicated.
- The adapter passes integration tests.

---

# 12. PHASE 5 — SHARED GRAPH STATE

Create:

`src/agent/state.js`

Define the authoritative state model used by the outer LangGraph workflow.

Include only information necessary for reliable execution.

Potential fields:

- `threadId`.
- `taskId`.
- `originalTask` if persistence policy permits.
- `sanitizedTask`.
- `plan`.
- `currentSubgoal`.
- `completedSubgoals`.
- `browserSession`.
- `latestObservation`.
- `verificationResult`.
- `recoveryCount`.
- `toolCallCount`.
- `modelCallCount` if reliably observable.
- `approvalStatus`.
- `pendingApproval`.
- `status`.
- `finalResult`.
- `error`.

Use the installed LangGraph state-definition API.

Do not blindly copy an outdated state-management example.

## State design rules

1. Avoid duplicating values that can be derived safely.
2. Define state-update semantics explicitly.
3. Prevent concurrent updates from corrupting execution state.
4. Avoid storing unnecessary secrets.
5. Minimize raw PII in checkpoints.
6. Preserve enough state for resumability.
7. Distinguish an unknown value from an empty value.
8. Distinguish execution failure from task failure.

Document the state contract.

Add schema validation where appropriate.

---

# 13. PHASE 6 — PRIVACY LAYER

Create or adapt:

`src/safety/privacy.js`

Inspect the existing privacy vault before implementing anything new.

Reuse its anonymization and rehydration mechanisms where practical.

## Requirements

### 13.1 Input handling

Process the user's task according to the existing privacy model.

Avoid transmitting unnecessary PII to external providers.

Preserve the original user intent when sanitizing.

### 13.2 Local rehydration

Rehydrate protected values locally at the appropriate execution boundary.

Do not rely on the LLM to reconstruct secrets or original PII.

Validate that placeholders cannot be confused with arbitrary model-generated values.

### 13.3 Tool outputs

Inspect browser observations before they enter model context.

Apply appropriate redaction to:

- Password fields.
- Authentication tokens.
- Sensitive form values.
- Private page content.
- Other protected information identified by the existing vault.

Avoid indiscriminate redaction that makes normal automation impossible.

### 13.4 Events and logging

Sanitize event payloads before they reach the UI or logs.

Do not log full tool arguments or page content by default.

### 13.5 Checkpoints

Determine which state fields need to be persisted.

Avoid storing API keys, cookies, authentication tokens, or unnecessary raw PII.

If the agent needs to resume a task involving sensitive values, design a local reference-based mechanism rather than persisting secrets unnecessarily.

### 13.6 Acceptance criteria

- Existing vault behavior remains compatible.
- Sanitization does not corrupt normal tasks.
- Rehydration is local and controlled.
- Logs and events redact sensitive information.
- Fallback providers respect privacy policy.
- Checkpoints do not unnecessarily persist secrets.

---

# 14. PHASE 7 — ACTION POLICY AND HUMAN APPROVAL

Create or adapt:

- `src/safety/action-policy.js`
- `src/safety/approval.js`
- `src/safety/url-policy.js`

Implement safety as executable application logic, not merely system-prompt instructions.

## 14.1 Action classification

Classify actions into appropriate risk categories.

Possible categories:

- Read-only.
- Reversible interaction.
- Sensitive operation.
- Irreversible operation.
- Restricted operation.

Use tool identity, target element, page context, and operation semantics where available.

Do not classify every `click_element` call as equally dangerous.

Do not assume every action named `submit` is harmless or every navigation is reversible.

## 14.2 Irreversible actions

Examples include:

- Sending messages or emails.
- Making payments.
- Deleting content.
- Submitting consequential forms.
- Publishing content.
- Changing sensitive account settings.

Define a policy for identifying these operations.

When approval is required, stop before executing the action.

The pending approval must describe the exact proposed operation and relevant context.

## 14.3 Approval binding

Bind approval to the specific pending action.

Before resuming:

- Verify the correct thread.
- Verify the approval is still pending.
- Verify the action has not changed.
- Verify the browser context remains valid.
- Prevent approval replay.
- Ensure rejection cannot accidentally execute the action.

If the target element or action changes, request a new approval when necessary.

## 14.4 URL policy

Define permitted URL schemes and navigation rules.

Consider:

- HTTP and HTTPS.
- Restricted Chrome pages.
- Local files.
- Downloads.
- Internal sites.
- Cross-origin navigation.
- Existing extension permissions.

Respect the existing extension's permission model.

Do not claim that an application-level URL check replaces Chrome's permission and origin restrictions.

## 14.5 Prompt-injection resistance

Treat web page content as untrusted input.

Page text must not override:

- System instructions.
- User authorization.
- Action policy.
- Privacy policy.
- Tool restrictions.
- Approval requirements.

Do not rely on prompt instructions alone to enforce these restrictions.

## 14.6 Acceptance criteria

- Restricted operations are blocked.
- Required approvals interrupt execution before the action.
- Rejected actions do not execute.
- Approved actions are bound to the original operation.
- Stale approvals cannot authorize changed operations.
- Policy decisions are auditable without leaking secrets.

---

# 15. PHASE 8 — LANGCHAIN AGENT AND MIDDLEWARE

Create or adapt:

`src/agent/agent.js`

Use LangChain `createAgent()` or the supported equivalent in the installed version.

## Requirements

Configure:

- Chat model.
- Browser tools.
- System prompt.
- Structured output where appropriate.
- Retry behavior.
- Fallback behavior.
- Context management.
- Model execution limits.
- Tool execution limits.
- Human-approval integration.
- Callbacks or supported lifecycle events.

Verify all APIs against installed package versions.

## 15.1 System prompt

Create a clear, maintainable system prompt.

The prompt must communicate:

- User-goal preservation.
- Current-page awareness.
- Tool-selection guidance.
- Fresh-observation requirements.
- Safe recovery behavior.
- No unsupported success claims.
- Untrusted-page-content boundaries.
- Approval requirements.
- Final-result requirements.

Do not place executable safety policies exclusively in the prompt.

## 15.2 Retry and fallback

Use framework middleware where supported.

If a required middleware is unavailable, select the best supported alternative and document the trade-off.

Avoid stacking multiple independent retry loops without explicit justification.

## 15.3 Execution limits

Keep these concepts distinct:

- Model invocation limit.
- Browser tool invocation limit.
- Graph recursion limit.
- Recovery attempt limit.
- Task duration limit.
- Context-size limit.

Do not treat model-call count as browser-action count.

Do not treat graph recursion limit as a precise business-level step budget.

Implement the required limits using supported framework capabilities and minimal custom policy code.

## 15.4 Context editing

Control context growth from repeated DOM snapshots.

Preserve recent, relevant observations.

Avoid clearing information needed for:

- Pending tool-call/result consistency.
- Current task state.
- Approval decisions.
- Verification.
- Recovery.

Test context editing against realistic long-running interactions.

## 15.5 Cancellation

Propagate the cancellation signal through supported invocation and browser-operation boundaries.

Verify cancellation behavior rather than assuming every component honors it.

## 15.6 Acceptance criteria

- The agent compiles.
- Tool calling works.
- Middleware configuration is valid.
- Context management preserves required information.
- Execution limits are enforced.
- Cancellation is handled.
- Structured output validates.
- No unsupported API assumptions remain.

---

# 16. PHASE 9 — PLANNER NODE

Create:

`src/agent/planner.js`

The planner converts the user's objective into a structured, verifiable plan.

Use structured model output where supported.

## Plan fields

Define an appropriate schema containing:

- Overall objective.
- Ordered subgoals.
- Subgoal descriptions.
- Relevant risk classification.
- Required observations.
- Completion criteria.
- Expected final evidence.
- Missing information, if any.

Adapt the schema to the actual application.

Do not overcomplicate planning for simple tasks.

## Planning rules

1. Preserve the user's actual intent.
2. Avoid inventing recipients, amounts, or other critical values.
3. Identify missing information.
4. Mark sensitive or irreversible operations.
5. Define how task completion will be verified.
6. Replan only when necessary.
7. Avoid repeating completed subgoals.
8. Treat the browser's live state as authoritative for page-specific facts.

The planner must not execute browser actions directly.

It produces a plan for the policy and browser-agent stages.

## Acceptance criteria

- Plan output validates against the schema.
- Missing critical information is represented explicitly.
- Risky actions are identified.
- Completion criteria are available to the verifier.
- Planning failures produce meaningful errors.

---

# 17. PHASE 10 — VERIFICATION NODE

Create:

`src/agent/verifier.js`

The verifier determines whether the user's actual objective has been achieved.

Do not treat the model's final text as proof.

## Requirements

### 17.1 Verify against live evidence

Use the actual browser state and task-specific evidence.

Examples:

For navigation:
- Verify the current URL or relevant page state.

For information extraction:
- Verify the required values were actually observed.

For form filling:
- Verify the intended fields contain the expected values.

For draft creation:
- Verify the draft is present where the service exposes reliable evidence.

For message sending:
- Verify the appropriate confirmation or other reliable evidence.

For deletion:
- Verify the expected resulting state without repeating the destructive operation.

### 17.2 Verification outcomes

Support at least:

- Verified success.
- Incomplete but recoverable.
- Blocked.
- Unverified.
- Failed.

Use a schema consistent with the rest of the application.

### 17.3 Avoid false positives

Do not declare success solely because:

- A tool returned without throwing.
- A click was attempted.
- The model claims the task is complete.
- The URL changed.
- A generic success toast appeared without matching the requested action.

Use the strongest practical evidence available.

If evidence is insufficient, return an unverified outcome.

### 17.4 Acceptance criteria

- Verification uses actual observations.
- Task-specific criteria are checked.
- Unsupported success claims are rejected.
- Missing evidence is represented explicitly.
- Verification failures can be routed to recovery.

---

# 18. PHASE 11 — RECOVERY NODE

Create:

`src/agent/recovery.js`

The recovery component selects an appropriate response to failure.

Prefer explicit state and bounded policies over custom orchestration loops.

## Recovery categories

Handle:

- Stale DOM.
- Missing elements.
- Navigation timeout.
- Content-script communication errors.
- Model rate limits.
- Provider failures.
- Tool argument errors.
- Verification failures.
- Unexpected tab changes.
- Restricted pages.
- Approval rejection.
- Cancellation.
- Exhausted execution budget.

## Recovery behavior

Possible decisions:

- Refresh the observation.
- Inspect the relevant element.
- Navigate back when appropriate.
- Wait for a page condition.
- Select another supported provider.
- Correct an invalid tool argument.
- Replan a failed subgoal.
- Ask the user for missing information.
- Stop safely.

Do not automatically repeat actions whose execution status is uncertain.

Do not re-run an irreversible action merely because its confirmation was lost.

Bound the number of recovery attempts.

Persist enough information to prevent repeated failed strategies across graph transitions.

## Acceptance criteria

- Recoverable failures have explicit routes.
- Repeated failures terminate safely.
- Recovery respects execution budgets.
- Sensitive operations are not replayed blindly.
- Unrecoverable errors produce clear final results.

---

# 19. PHASE 12 — LANGGRAPH OUTER WORKFLOW

Create:

`src/agent/graph.js`

Build the actual graph using the supported LangGraph API.

The graph should orchestrate the major workflow stages.

Expected logical nodes:

- `intake`.
- `privacy`.
- `planner`.
- `policy`.
- `browser_agent`.
- `verification`.
- `recovery`.
- `finalize`.

Add an approval interrupt or equivalent supported mechanism for pending human decisions.

You may combine nodes where this reduces complexity without sacrificing safety.

## Graph requirements

### 19.1 Conditional routing

Route based on explicit state.

Examples:

- Policy denial → safe final result.
- Approval required → interrupt.
- Approved action → authorized execution.
- Verified success → finalization.
- Recoverable failure → recovery.
- Recovery requires new strategy → planner.
- Missing user information → blocked or awaiting-input result.
- Exhausted budget → controlled termination.

### 19.2 Bounded execution

Prevent endless planning/recovery cycles.

Use supported graph recursion safeguards and explicit task-level budgets.

Do not introduce an unbounded custom `while` loop.

### 19.3 Subgraph composition

Integrate the LangChain agent as a graph node or subgraph using the supported APIs.

Do not assume compiled graphs and agents can be nested arbitrarily without checking their invocation and state contracts.

### 19.4 Topology inspection

Expose a diagnostic way to inspect the actual compiled graph.

Use the installed framework's supported graph-visualization API where available.

Do not invent a `getGraph()` or `drawMermaid()` API if the installed version uses a different method.

If visualization is available, generate a Mermaid representation and save it to:

`docs/agent-graph.mmd`

### 19.5 Acceptance criteria

- The graph compiles.
- Every expected node is connected.
- Conditional routing works.
- Recovery is bounded.
- Approval interrupts execution.
- Successful tasks reach finalization.
- Failed tasks terminate with meaningful results.
- Graph topology can be inspected.

---

# 20. PHASE 13 — PERSISTENT CHECKPOINTING

Create or adapt:

- `src/persistence/checkpointer.js`
- `src/persistence/thread-store.js`

Inspect the current extension lifecycle and existing storage layer before selecting the implementation.

## Requirements

### 20.1 Checkpointer selection

Use a supported LangGraph checkpointer.

Do not assume an in-memory saver is production-persistent.

For Chrome Manifest V3, evaluate the implications of service-worker termination.

### 20.2 Local persistence

If persistent local storage is needed, implement a compatible storage adapter or integrate an existing supported implementation.

Do not pretend that `chrome.storage` automatically implements the LangGraph checkpointer interface.

Handle:

- Serialization.
- Concurrent writes.
- Partial failures.
- Checkpoint lookup.
- Thread isolation.
- Schema evolution.
- Storage quota.
- Corrupted records.
- Cleanup.

### 20.3 Resume behavior

Support resuming an interrupted task using the correct thread identifier.

Ensure that:

- Approval resumes the correct execution.
- Stale tabs are detected.
- Pending actions are revalidated.
- Rejected operations do not execute.
- Expired or invalid state fails safely.
- Secrets are not unnecessarily persisted.

### 20.4 Storage security

Inspect the actual extension storage and threat model.

Use the narrowest appropriate storage mechanism.

Do not claim local storage provides encryption unless encryption is actually implemented.

### 20.5 Acceptance criteria

- Checkpoints persist according to the selected strategy.
- Threads remain isolated.
- Approval survives supported lifecycle interruptions.
- Invalid checkpoint data fails safely.
- Resumption does not duplicate completed irreversible actions.

---

# 21. PHASE 14 — EVENT STREAMING AND UI INTEGRATION

Create or adapt:

`src/ui/agent-events.js`

Preserve existing UI event contracts where practical.

The UI should receive meaningful lifecycle updates.

Potential events:

- `TASK_STARTED`.
- `PLAN_CREATED`.
- `TOOL_CALL`.
- `OBSERVATION`.
- `TOOL_ERROR`.
- `APPROVAL_REQUIRED`.
- `APPROVAL_GRANTED`.
- `APPROVAL_REJECTED`.
- `VERIFICATION_STARTED`.
- `VERIFICATION_FAILED`.
- `RECOVERY_STARTED`.
- `TASK_COMPLETED`.
- `TASK_FAILED`.

## Requirements

1. Use supported framework callbacks or streaming events.
2. Preserve compatibility with the existing UI where practical.
3. Redact sensitive information.
4. Do not expose API keys or raw credentials.
5. Do not expose hidden model reasoning.
6. Separate operational events from final user-facing messages.
7. Handle cancellation and disconnects.
8. Prevent duplicate terminal events.
9. Keep event payloads small and structured.

If the UI already expects different event names, create a thin compatibility adapter rather than rewriting the UI unnecessarily.

## Acceptance criteria

- The UI receives progress updates.
- Tool errors are visible in an appropriate form.
- Approval requests can be displayed.
- Sensitive information is redacted.
- Terminal task status is consistent.

---

# 22. PHASE 15 — MAIN EXECUTION ENTRY POINT

Integrate the completed system into the actual application entry point.

Do not leave the graph accessible only through isolated test code.

Identify how the current UI starts a task and connect that path to the compiled graph.

The execution entry point must:

1. Validate the user task.
2. Resolve the selected model.
3. Resolve the correct active tab.
4. Create or retrieve the appropriate task thread.
5. Establish execution budgets.
6. Pass cancellation signals where supported.
7. Invoke the graph.
8. Stream events to the UI.
9. Handle approval interrupts.
10. Persist resumable state.
11. Return the final structured result.
12. Clean up temporary state safely.

Keep responsibilities separated.

Do not move all application logic into a single enormous `agent.js` file.

Ensure that the extension's existing start, stop, resume, and reset controls behave correctly.

---

# 23. PHASE 16 — TESTING

Build a meaningful test suite using the repository's existing testing framework.

If no test framework exists, choose a compatible one based on the project's runtime and bundler.

Do not introduce a large testing stack unnecessarily.

## 23.1 Unit tests

Test:

- Tool schemas.
- Schema conversions.
- Model configuration validation.
- Action classification.
- URL policy.
- Privacy sanitization.
- Structured plan validation.
- Verification decisions.
- Recovery decisions.
- Execution limits.
- Event redaction.

## 23.2 Browser-tool tests

Mock Chrome APIs where appropriate.

Test:

- Navigation success.
- Navigation timeout.
- Content-script failure.
- Missing elements.
- Tab switching.
- Stale DOM.
- Message-channel closure.
- Uncertain action outcomes.
- Cancellation.
- Screenshot capture failure.
- Restricted pages.

Mocks must not be mistaken for real browser integration tests.

## 23.3 Agent integration tests

Use deterministic fake chat models or supported test doubles.

Test:

- Correct tool selection.
- Tool argument validation.
- Tool errors returned to the agent.
- Model retry behavior.
- Fallback behavior.
- Context editing.
- Execution limits.
- Structured final results.

## 23.4 Graph tests

Test:

- Successful execution.
- Recoverable failure.
- Replanning.
- Bounded recovery.
- Policy denial.
- Approval interrupt.
- Approval approval path.
- Approval rejection path.
- Invalid resume.
- Cancellation.
- Checkpoint persistence.
- Resume after interruption.
- Finalization after verification.

## 23.5 Security tests

Test:

- Prompt injection in webpage content.
- Attempts to bypass approval.
- Restricted URL navigation.
- Arbitrary JavaScript restrictions.
- PII leakage in logs.
- PII leakage in events.
- Sensitive checkpoint contents.
- Duplicate approval.
- Repeated irreversible actions.

## 23.6 End-to-end tests

Where practical, test the actual extension against controlled local test pages.

Do not use live financial or messaging actions as default test cases.

Include scenarios that verify:

- A user task reaches the graph.
- The model selects browser tools.
- The browser performs the operation.
- Observations reach the agent.
- The verifier evaluates the result.
- The final response accurately reflects the outcome.

## 23.7 Acceptance criteria

Report each test category separately.

Distinguish:

- Passed.
- Failed.
- Skipped.
- Not implemented.
- Blocked by environment.

Never report unexecuted tests as passing.

---

# 24. PHASE 17 — BUILD AND BUNDLE VALIDATION

Because PRATYAKSHA is a Chrome Extension, a working Node.js test is not sufficient.

Validate the actual extension build.

Inspect:

- Manifest V3 compatibility.
- Service-worker entry point.
- Content-script entry points.
- Module resolution.
- ESM/CJS compatibility.
- Provider package bundling.
- Extension permissions.
- Content-script injection.
- Dynamic imports.
- Worker compatibility.
- Build output size.
- Browser API availability.

Avoid importing Node-only modules into extension execution contexts unless the bundler provides a correct, supported solution.

If a package is too large or incompatible, investigate the cause and select the least disruptive solution.

Do not add a bundler workaround without understanding which module or runtime requirement caused the failure.

Produce a build report.

---

# 25. PHASE 18 — FINAL INTEGRATION

After all modules are implemented, perform a dedicated integration pass.

Do not assume that individually passing unit tests prove the system works.

## Verify the entire execution path

Trace one representative task through:

```text
UI
 |
 v
Task entry point
 |
 v
Privacy processing
 |
 v
Planner
 |
 v
Policy
 |
 v
LangGraph workflow
 |
 v
LangChain agent
 |
 v
Model
 |
 v
Tool call
 |
 v
Existing browser dispatcher
 |
 v
Chrome content script
 |
 v
Fresh browser observation
 |
 v
Verification
 |
 v
Final structured result
 |
 v
UI
```

Verify that:

- Every module is imported correctly.
- The runtime uses the compiled graph.
- The graph invokes the actual browser agent.
- The browser agent invokes real browser tools.
- Observations reach the correct execution context.
- Tool results are not accidentally discarded.
- Checkpoints are used during actual invocation.
- Approval interrupts are resumable.
- Final success depends on verification.
- Errors reach the UI.
- Cancellation works as designed.
- The build includes all required modules.

Fix integration defects before declaring completion.

---

# 26. WORKING IN CHUNKS — MANDATORY EXECUTION PROTOCOL

You must work in the following order.

## Chunk A — Discovery

Deliverables:

- Repository audit.
- Dependency compatibility audit.
- Current architecture map.
- Proposed directory structure.
- File migration map.
- Implementation plan.

No production modifications before the baseline inspection is complete.

## Chunk B — Shared contracts and tool schemas

Deliverables:

- Authoritative tool registry.
- Schema validation.
- Schema conversion tests.
- Standard tool result contract.

## Chunk C — Browser execution hardening

Deliverables:

- Correct error semantics.
- Navigation reliability.
- Safe retry behavior.
- Tab consistency.
- Fresh observation handling.
- Cancellation behavior.

## Chunk D — Model factory

Deliverables:

- Provider configuration.
- Tool-capable model selection.
- Retry policy.
- Fallback policy.
- Configuration tests.

## Chunk E — LangChain tool integration

Deliverables:

- Browser tool adapters.
- Schema integration.
- Tool error handling.
- Observation handling.
- Agent smoke test.

## Chunk F — Privacy and safety

Deliverables:

- Privacy integration.
- Action policy.
- URL policy.
- Approval requirements.
- Redacted event logging.

## Chunk G — Shared state and planning

Deliverables:

- Graph state.
- Structured plan schema.
- Planner node.
- Planner tests.

## Chunk H — Verification and recovery

Deliverables:

- Verification node.
- Recovery node.
- Explicit failure states.
- Bounded recovery tests.

## Chunk I — LangGraph orchestration

Deliverables:

- Compiled graph.
- Conditional routing.
- Agent integration.
- Graph topology output.
- Graph execution tests.

## Chunk J — Checkpointing and resume

Deliverables:

- Supported checkpointer integration.
- Thread management.
- Approval persistence.
- Resume validation.
- Persistence tests.

## Chunk K — Events and UI integration

Deliverables:

- Framework lifecycle integration.
- Existing event compatibility.
- Approval UI integration.
- Cancellation integration.

## Chunk L — Final integration

Deliverables:

- Complete application execution path.
- Extension build.
- Integration tests.
- Security regression tests.
- Final documentation.

You may split a chunk into smaller subchunks if needed.

You may combine chunks only when dependencies and testing remain clear.

Do not skip a chunk merely because it appears straightforward.

---

# 27. REQUIRED REPORT AFTER EVERY CHUNK

At the end of every chunk, produce a concise report in this format:

## Chunk [ID] — [Name]

### Completed
List the actual changes made.

### Files created
List new files and their purpose.

### Files modified
List modified files and the reason for each modification.

### Files removed or moved
List changes and compatibility implications.

### Tests executed
List exact commands and their actual results.

### Issues discovered
List relevant issues.

### Remaining work
List incomplete requirements.

### Next chunk
State the next implementation stage.

Do not claim completion when acceptance criteria remain unmet.

If a blocker prevents progress, explain the exact blocker, what you attempted, and what decision or access is required.

Otherwise, proceed to the next chunk automatically.

---

# 28. FILE-BY-FILE IMPLEMENTATION REQUIREMENTS

Before editing a file:

1. Read the existing file.
2. Identify its callers.
3. Identify its dependencies.
4. Determine the intended responsibility after migration.
5. Plan the change.
6. Implement it.
7. Update imports and callers.
8. Add or update tests.
9. Run relevant checks.
10. Record the result.

When a file is created, verify that it is imported into the actual application execution path when required.

Do not create unused modules merely to satisfy the proposed folder structure.

Do not place duplicate business logic in both old and new modules.

If a file is moved, update all references and verify the build.

If an existing interface must change, identify all callers and migrate them together.

Prefer small, coherent edits over giant rewrites.

Do not leave two competing agent implementations active unless the transition explicitly requires temporary compatibility.

---

# 29. GIT AND CHANGE MANAGEMENT

Before implementation:

- Inspect the Git working tree.
- Inspect the current branch.
- Identify uncommitted user changes.
- Do not overwrite user changes.
- Do not reset or clean the repository destructively.

Keep changes scoped to PRATYAKSHA.

Do not automatically commit, push, force-push, or modify remote branches.

If the repository already contains uncommitted work, preserve it.

If a migration requires deleting or moving files, verify that the replacements are integrated before removing the originals.

Prefer coherent checkpoints in the implementation process.

Do not introduce unrelated formatting changes across the entire repository.

---

# 30. PERFORMANCE REQUIREMENTS

Optimize for reliable browser execution rather than minimizing code at all costs.

Consider:

- Model latency.
- Token usage.
- DOM snapshot size.
- Repeated observations.
- Tool-call overhead.
- Retry overhead.
- Provider rate limits.
- Extension bundle size.
- Checkpoint serialization overhead.

Avoid returning the full DOM table after every read-only tool.

Avoid repeatedly sending the same large page snapshot if no relevant state has changed.

Use context editing carefully.

Do not remove information required for correct tool execution or verification merely to reduce token usage.

Use structured outputs for plans and final results when supported.

Do not introduce unnecessary planner calls for trivial tasks.

---

# 31. FINAL ACCEPTANCE CRITERIA

The project is complete only when all applicable requirements below are satisfied.

## Architecture

- Existing browser code is reused appropriately.
- LangChain handles the model/tool execution loop.
- LangGraph manages the outer workflow.
- The final graph compiles.
- The actual application invokes the graph.
- The proposed structure reflects real module responsibilities.

## Tools

- The tool registry is consistent.
- Tool schemas are validated.
- Browser tools execute through LangChain.
- Tool errors propagate correctly.
- Fresh observations are handled correctly.
- Screenshot behavior is honest about multimodal support.

## Reliability

- Model retries are bounded.
- Fallback behavior is correct.
- Browser actions are not blindly replayed.
- Recovery is bounded.
- Timeouts are not reported as success.
- Cancellation is handled.
- Execution limits are enforced.

## Safety

- Sensitive actions require the configured approval.
- Rejected actions do not execute.
- Stale approvals cannot authorize changed actions.
- URL policy is enforced.
- Arbitrary JavaScript is treated as privileged.
- Webpage prompt injection cannot override application policy.
- Final success requires appropriate verification.

## Privacy

- Existing PII-vault functionality is preserved.
- Sensitive values are not unnecessarily sent to providers.
- Logs and events are redacted.
- Checkpoints avoid unnecessary secret persistence.
- Provider fallback respects privacy restrictions.

## Persistence

- Checkpointer integration is valid.
- Thread IDs are managed correctly.
- Supported interruptions can resume.
- Browser context is revalidated after resumption.
- Duplicate irreversible actions are prevented.

## Integration

- All modules are connected.
- UI start/stop/resume behavior works.
- Event streaming works.
- The extension builds.
- Integration tests pass or their failures are explicitly documented.

## Documentation

The repository contains:

- `docs/implementation-audit.md`.
- `docs/implementation-plan.md`.
- `docs/architecture.md`.
- `docs/agent-graph.mmd`, if graph visualization is supported.
- Updated setup instructions.
- Updated environment-variable documentation.
- Updated testing instructions.
- A final implementation report.

---

# 32. FINAL REPORT

When the implementation is finished, provide a comprehensive final report containing:

## A. Architecture delivered

Describe the actual architecture implemented.

Do not describe planned features as completed features.

## B. Files created

List each new file and its responsibility.

## C. Files modified

List significant modifications and why they were needed.

## D. Existing files preserved

Identify major browser components that were retained.

## E. Execution flow

Explain how a user task travels through the actual application.

## F. LangChain integration

Describe:

- Model factory.
- Tool adapters.
- Middleware.
- Structured output.
- Retry/fallback behavior.

## G. LangGraph integration

Describe:

- Graph nodes.
- Conditional routing.
- Verification.
- Recovery.
- Approval interrupts.
- Checkpointing.

## H. Security and privacy

Explain the implemented policies and remaining limitations.

## I. Test results

Report actual commands, pass/fail status, skipped tests, and environmental blockers.

## J. Build status

State whether the extension build succeeded.

## K. Known limitations

List all material unresolved issues.

## L. Manual testing instructions

Provide precise steps for loading the extension and testing representative tasks.

## M. Final status

Use one of:

- COMPLETE — all required acceptance criteria verified.
- PARTIALLY COMPLETE — core implementation exists, but specified criteria remain unmet.
- BLOCKED — a specific external requirement prevents further progress.

Do not use COMPLETE merely because the files were written.

---

# 33. START EXECUTION NOW

Begin with Chunk A: Repository Discovery.

Do not start by creating the target files blindly.

Inspect the existing codebase, determine the current architecture, verify installed framework versions, identify reusable modules, and produce the audit and implementation plan.

After Chunk A, continue through the implementation chunks in order.

Work file by file.

Test incrementally.

Integrate the modules as they are completed.

Resolve compatibility issues based on the actual installed APIs.

Preserve existing functionality.

Do not stop at documentation or code examples.

**Your final objective is a fully integrated, tested, and buildable PRATYAKSHA agent that uses LangChain for model/tool execution and LangGraph for workflow orchestration, while preserving the existing Chrome browser automation engine and enforcing explicit privacy, safety, and verification policies.**