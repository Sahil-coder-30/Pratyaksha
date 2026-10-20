/**
 * PRATYAKSHA LangGraph StateGraph Workflow
 * Sovereign Privacy-First Browser Agent
 *
 * Orchestrates the modular agent workflow:
 * - Independent Planner Agent (`plannerAgentNode`) in `planner-agent.js`
 * - Core Browser Actor Agent (`browserActorAgentNode`) in `browser-actor-agent.js`
 * with boundary safety checks (privacy, policy, verification, recovery, finalize).
 */

import { StateGraph, START, END, interrupt } from '@langchain/langgraph';
import { ToolMessage } from '@langchain/core/messages';
import { AgentState } from './state.js';
import { anonymizeInputTask, sanitizeObservationForModel } from '../safety/privacy.js';
import { evaluateInputWithJev, evaluateOutputWithJev } from '../safety/jev-guard.js';
import { plannerAgentNode, createPlannerAgent } from './planner-agent.js';
import { browserActorAgentNode, createBrowserActorAgent, executeApprovedToolCall } from './browser-actor-agent.js';
import { classifyAction } from '../safety/action-policy.js';
import { createApprovalRequest } from '../safety/approval.js';
import { verifierNode } from './verifier.js';
import { recoveryNode } from './recovery.js';
import { TOOL_NAMES } from '../shared/constants.js';

export { createPlannerAgent, createBrowserActorAgent };

/**
 * Builds the human-approval node for a tool call the actor proposed.
 * The node only interrupts and executes, so when LangGraph re-runs it on resume
 * nothing expensive or non-deterministic (DOM scan, LLM call) is repeated.
 */
function createToolApprovalNode(options = {}) {
  const { chromeApi, vault, events, checkpointer } = options;

  return async (state) => {
    const pending = state.pendingToolCall;
    if (!pending?.toolCall) {
      return { pendingToolCall: null, status: 'ACTING' };
    }

    let decision = null;
    if (checkpointer) {
      const request = createApprovalRequest({
        threadId: state.threadId || 'thread_local',
        action: { toolName: pending.toolCall.name, args: pending.toolCall.args },
        reason: pending.reason,
        pageContext: { url: pending.url, title: pending.title }
      });
      decision = interrupt({
        type: 'TOOL_APPROVAL_REQUIRED',
        request,
        action: pending.toolCall,
        reason: pending.reason,
        riskTier: pending.riskTier,
        summary: pending.summary
      });
    }

    const approved = decision === true || decision?.approved === true || decision?.status === 'APPROVED';
    if (!approved) {
      const why = decision?.reason || (checkpointer ? 'User denied the action.' : 'Approval channel unavailable.');
      events?.emit?.('THINKING', {
        phase: 'approval',
        text: `Action rejected: ${pending.toolCall.name} (${why})`,
        step: state.stepCount
      });
      return {
        messages: [new ToolMessage({
          tool_call_id: pending.toolCall.id,
          name: pending.rawName || pending.toolCall.name,
          content: `REJECTED_BY_OPERATOR: The user did not allow ${pending.toolCall.name}. Reason: ${why} Do not retry this action; choose a safe alternative or finish the task explaining it was not permitted.`
        })],
        pendingToolCall: null,
        approvalStatus: 'REJECTED',
        status: decision?.terminate ? 'OPERATOR_REJECTED' : 'ACTING'
      };
    }

    events?.emit?.('THINKING', {
      phase: 'action',
      text: `Executing approved ${pending.toolCall.name}`,
      toolName: pending.toolCall.name,
      args: pending.toolCall.args,
      step: state.stepCount
    });

    const { observation, result, activeTab } = await executeApprovedToolCall(pending, {
      chromeApi,
      vault,
      signal: options.signal
    });
    const failed = /^(ERROR|BLOCKED)/.test(observation || '');

    events?.emit?.('OBSERVATION', { observation, toolName: pending.toolCall.name, step: state.stepCount });

    return {
      messages: [new ToolMessage({
        tool_call_id: pending.toolCall.id,
        name: pending.rawName || pending.toolCall.name,
        content: sanitizeObservationForModel(observation, vault)
      })],
      pendingToolCall: null,
      approvalStatus: 'APPROVED',
      latestObservation: result ? { ...result, args: pending.toolCall.args } : null,
      browserSession: {
        tabId: activeTab?.id ?? state.browserSession?.tabId,
        url: result?.page?.url || state.browserSession?.url || '',
        title: result?.page?.title || state.browserSession?.title || ''
      },
      status: result?.isFinished ? 'TASK_FINISHED_SIGNAL' : (failed ? 'TOOL_ERROR' : 'ACTING')
    };
  };
}

/**
 * Shared routing after an acting step (browser_agent or tool_approval).
 */
function routeAfterAct(state, maxSteps) {
  if (state.status === 'AWAITING_TOOL_APPROVAL') return 'tool_approval';
  if (state.status === 'TERMINATED' || state.status === 'OPERATOR_REJECTED') return 'finalize';
  if (state.latestObservation?.isFinished || state.status === 'TASK_FINISHED_SIGNAL') return 'verification';
  if ((state.stepCount || 0) >= maxSteps) return 'verification';
  if (state.status === 'TOOL_ERROR') return 'recovery';
  return 'browser_agent';
}

/**
 * Creates and compiles the complete LangGraph agent workflow.
 */
export function createAgentGraph(options = {}) {
  const model = options.model;
  const chromeApi = options.chromeApi;
  const vault = options.vault;
  const checkpointer = options.checkpointer;
  const maxSteps = options.maxSteps || 100;
  const events = options.events;

  const workflow = new StateGraph(AgentState)

    // ── 1. INTAKE NODE ────────────────────────────────────────────────────────
    .addNode('intake', async (state) => {
      const originalTask = (state.originalTask || '').trim();
      if (!originalTask) {
        return {
          status: 'BLOCKED',
          error: { message: 'Task cannot be empty.' }
        };
      }
      events?.emit?.('THINKING', {
        phase: 'intake',
        text: `Starting browser task: "${originalTask}"`,
        step: 0,
        maxSteps
      });
      return {
        taskId: state.taskId || `task_${Date.now()}`,
        threadId: state.threadId || `thread_${Date.now()}`,
        status: 'INTAKE_COMPLETE'
      };
    })

    // ── 2. PRIVACY NODE ───────────────────────────────────────────────────────
    .addNode('privacy', async (state) => {
      const { sanitizedText, detected } = anonymizeInputTask(state.originalTask, vault);
      if (detected.length > 0) {
        events?.emit?.('THINKING', {
          phase: 'privacy',
          text: `Privacy Shield: Anonymized ${detected.length} sensitive credential/token item(s).`,
          piiDetectedCount: detected.length,
          step: 0,
          maxSteps
        });
      }
      return {
        sanitizedTask: sanitizedText,
        status: 'PRIVACY_APPLIED',
        metadata: { piiDetectedCount: detected.length }
      };
    })

    // ── 2b. JEV INPUT GUARD NODE (Machine-Native System One) ─────────────────
    .addNode('jev_input_guard', async (state) => {
      const task = state.sanitizedTask || state.originalTask || '';
      events?.emit?.('THINKING', {
        phase: 'guardrail',
        text: 'Screening task boundary via TypeSafe Jev System One model…',
        step: 0,
        maxSteps
      });

      const jevResult = await evaluateInputWithJev(task, state.browserSession, options);

      if (!jevResult.allowed) {
        events?.emit?.('THINKING', {
          phase: 'guardrail',
          text: `Task blocked by TypeSafe Jev guardrail: ${jevResult.reason}`,
          step: 0,
          maxSteps
        });
        return {
          status: 'BLOCKED',
          jevInputResult: jevResult,
          error: { message: `Task rejected by safety guardrail: ${jevResult.reason}` }
        };
      }

      return {
        status: 'JEV_INPUT_PASSED',
        jevInputResult: jevResult
      };
    })

    // ── 3. PLANNER AGENT NODE (Independent Module) ───────────────────────────
    .addNode('planner', async (state) => {
      return plannerAgentNode(state, {
        model,
        useModelPlanner: options.useModelPlanner,
        events,
        maxSteps
      });
    })

    // ── 3b. PLAN PROCEEDING HITL GATE ─────────────────────────────────────────
    .addNode('plan_gate', async (state) => {
      const subgoals = state.plan?.subgoals || [];
      const hasHighRiskSubgoal = subgoals.some(s => s.riskTier === 'HIGH' || s.riskTier === 'RESTRICTED');
      const requiresPlanApproval = hasHighRiskSubgoal || options.forcePlanApproval === true;

      if (requiresPlanApproval && state.planApprovalStatus !== 'APPROVED') {
        events?.emit?.('THINKING', {
          phase: 'approval',
          text: 'Plan contains high-risk subgoals: awaiting operator confirmation before browser execution',
          step: 0,
          maxSteps
        });
        events?.emit?.('PLAN_APPROVAL_REQUIRED', {
          plan: state.plan,
          subgoals,
          threadId: state.threadId
        });

        if (options.enableInterrupts !== false) {
          try {
            const approvalRes = interrupt({
              type: 'PLAN_APPROVAL_REQUIRED',
              plan: state.plan,
              reason: 'Plan includes high-risk or irreversible browser actions'
            });

            if (approvalRes && (approvalRes.approved === false || approvalRes.status === 'REJECTED')) {
              return {
                status: 'PLAN_REJECTED',
                planApprovalStatus: 'REJECTED',
                error: { message: 'Operator cancelled task execution during plan review.' }
              };
            }

            return {
              status: 'PLAN_APPROVED',
              planApprovalStatus: 'APPROVED'
            };
          } catch (err) {
            // interrupt() pauses the graph by throwing: never swallow it
            if (err?.name === 'GraphInterrupt' || err?.constructor?.name === 'GraphInterrupt') throw err;
            console.warn('[PlanGate] Interrupt not supported in execution context:', err.message);
          }
        }

        return {
          status: 'AWAITING_PLAN_APPROVAL',
          pendingPlanApproval: state.plan
        };
      }

      return {
        status: 'PLAN_APPROVED',
        planApprovalStatus: 'APPROVED'
      };
    })

    // ── 4. POLICY NODE ────────────────────────────────────────────────────────
    .addNode('policy', async (state) => {
      const subgoals = state.plan?.subgoals || [];
      const currentIdx = state.currentSubgoalIndex || 0;
      const currentSubgoal = subgoals[currentIdx];

      if (!currentSubgoal) {
        return { status: 'POLICY_ALLOWED' };
      }

      const toolName = currentSubgoal.expectedAction || TOOL_NAMES.CLICK_ELEMENT;
      const policyDecision = classifyAction(toolName, {}, state.browserSession);

      if (policyDecision.riskTier === 'RESTRICTED') {
        events?.emit?.('THINKING', {
          phase: 'policy',
          text: `Action blocked by policy: ${policyDecision.reason}`,
          step: state.stepCount,
          maxSteps
        });
        return {
          status: 'POLICY_DENIED',
          error: { message: `Operation rejected: ${policyDecision.reason}` }
        };
      }

      if (policyDecision.requiresApproval) {
        if (state.approvalStatus !== 'APPROVED') {
          const req = createApprovalRequest({
            threadId: state.threadId,
            action: { toolName, args: {} },
            reason: policyDecision.reason,
            pageContext: state.browserSession
          });

          if (options.enableInterrupts !== false) {
            interrupt({
              type: 'APPROVAL_REQUIRED',
              request: req
            });
          }

          events?.emit?.('THINKING', {
            phase: 'approval',
            text: `High-risk action intercepted: requires user confirmation (${policyDecision.reason})`,
            step: state.stepCount,
            maxSteps
          });

          return {
            status: 'AWAITING_APPROVAL',
            pendingApproval: req
          };
        }
      }

      return { status: 'POLICY_ALLOWED' };
    })

    // ── 5. CORE BROWSER ACTOR AGENT NODE (Independent Module) ────────────────
    .addNode('browser_agent', async (state) => {
      return browserActorAgentNode(state, {
        model,
        chromeApi,
        vault,
        signal: options.signal,
        maxSteps,
        events,
        enableInterrupts: options.enableInterrupts,
        exposeAllTools: options.exposeAllTools,
        tinyfishApiKey: options.tinyfishApiKey
      });
    })

    // ── 5b. TOOL APPROVAL NODE (Human-in-the-Loop) ───────────────────────────
    .addNode('tool_approval', createToolApprovalNode({ ...options, chromeApi, vault, events, checkpointer, tinyfishApiKey: options.tinyfishApiKey }))

    // ── 6. VERIFICATION NODE ──────────────────────────────────────────────────
    .addNode('verification', async (state) => {
      return verifierNode(state, { events });
    })

    // ── 7. RECOVERY NODE ──────────────────────────────────────────────────────
    .addNode('recovery', async (state) => {
      events?.emit?.('THINKING', {
        phase: 'recovery',
        text: `Triggering recovery & backtracking logic (Attempt ${(state.recoveryCount || 0) + 1})…`,
        step: state.stepCount,
        maxSteps
      });
      return recoveryNode(state, { chromeApi });
    })

    // ── 7b. JEV OUTPUT GUARD NODE (Machine-Native System One) ────────────────
    .addNode('jev_output_guard', async (state) => {
      const rawSummary = state.latestObservation?.summary || state.verificationResult?.reason || '';
      const evidence = state.verificationResult?.evidence || '';

      events?.emit?.('THINKING', {
        phase: 'guardrail',
        text: 'Screening final output groundedness via TypeSafe Jev System One model…',
        step: state.stepCount,
        maxSteps
      });

      const jevOut = await evaluateOutputWithJev(rawSummary, evidence, options);

      // Scrub output PII so tokens never leak into finalResult
      let cleanSummary = rawSummary;
      if (vault) {
        cleanSummary = anonymizeInputTask(rawSummary, vault).sanitizedText;
      }

      return {
        jevOutputResult: jevOut,
        latestObservation: state.latestObservation
          ? { ...state.latestObservation, summary: cleanSummary }
          : null
      };
    })

    // ── 8. FINALIZE NODE ──────────────────────────────────────────────────────
    .addNode('finalize', async (state) => {
      if (state.status === 'AWAITING_PLAN_APPROVAL') {
        return {
          status: 'AWAITING_PLAN_APPROVAL',
          pendingPlanApproval: state.pendingPlanApproval,
          finalResult: {
            success: false,
            awaitingPlanApproval: true,
            pendingPlanApproval: state.pendingPlanApproval,
            summary: 'Execution paused: Plan requires operator confirmation before proceeding.',
            steps: 0,
            evidence: 'Awaiting plan approval'
          }
        };
      }

      if (state.status === 'PLAN_REJECTED') {
        return {
          status: 'TERMINATED',
          finalResult: {
            success: false,
            cancelledByOperator: true,
            summary: state.error?.message || 'Plan rejected by operator.',
            steps: 0,
            evidence: 'Operator rejected plan'
          }
        };
      }

      if (state.status === 'AWAITING_APPROVAL') {
        return {
          status: 'AWAITING_APPROVAL',
          pendingApproval: state.pendingApproval,
          finalResult: {
            success: false,
            awaitingApproval: true,
            pendingApproval: state.pendingApproval,
            summary: `Action requires approval: ${state.pendingApproval?.reason || 'Sensitive operation'}`,
            steps: state.stepCount || 1,
            evidence: 'Awaiting human confirmation'
          }
        };
      }

      if (state.status === 'OPERATOR_REJECTED') {
        return {
          status: 'TERMINATED',
          finalResult: {
            success: false,
            cancelledByOperator: true,
            summary: 'Action rejected by user.',
            steps: state.stepCount || 1,
            evidence: 'Operator rejected a pending action'
          }
        };
      }

      if (state.status === 'AWAITING_USER_INPUT') {
        const missing = state.plan?.missingInformation?.join('; ') || 'Required details missing';
        return {
          status: 'TERMINATED',
          finalResult: {
            success: false,
            awaitingUserInput: true,
            summary: `Additional information required before execution: ${missing}`,
            steps: state.stepCount || 1,
            evidence: 'Awaiting user input',
            missingInformation: state.plan?.missingInformation || []
          }
        };
      }

      const isSuccess = state.verificationResult?.verified ||
        (state.latestObservation?.isFinished && state.latestObservation?.success);

      let summary = '';
      if (isSuccess) {
        summary = state.latestObservation?.summary || state.verificationResult?.reason || 'Goal accomplished successfully.';
      } else {
        if (state.latestObservation?.isFinished && state.latestObservation?.success === false && state.latestObservation?.summary) {
          summary = state.latestObservation.summary;
        } else if (state.error?.message) {
          summary = state.error.message;
        } else if (state.verificationResult?.reason) {
          summary = state.verificationResult.reason;
        } else if ((state.stepCount || 0) >= maxSteps) {
          summary = `Execution step limit (${maxSteps}) reached before goal could be verified.`;
        } else {
          summary = 'Task stopped: Browser state did not satisfy completion criteria.';
        }
      }

      return {
        status: isSuccess ? 'COMPLETED' : 'TERMINATED',
        finalResult: {
          success: !!isSuccess,
          summary,
          steps: state.stepCount || 1,
          evidence: state.verificationResult?.evidence || 'Recorded browser history',
          error: !isSuccess ? state.error : null
        }
      };
    })

    // ── EDGES & CONDITIONAL ROUTING ───────────────────────────────────────────
    .addEdge(START, 'intake')
    .addConditionalEdges('intake', (state) => {
      if (state.status === 'BLOCKED') return 'finalize';
      return 'privacy';
    }, {
      privacy: 'privacy',
      finalize: 'finalize'
    })
    .addEdge('privacy', 'jev_input_guard')

    .addConditionalEdges('jev_input_guard', (state) => {
      if (state.status === 'BLOCKED') return 'finalize';
      return 'planner';
    }, {
      planner: 'planner',
      finalize: 'finalize'
    })

    .addConditionalEdges('planner', (state) => {
      if (state.status === 'AWAITING_USER_INPUT') return 'finalize';
      return 'plan_gate';
    }, {
      plan_gate: 'plan_gate',
      finalize: 'finalize'
    })

    .addConditionalEdges('plan_gate', (state) => {
      if (state.status === 'AWAITING_PLAN_APPROVAL' || state.status === 'PLAN_REJECTED') return 'finalize';
      return 'policy';
    }, {
      policy: 'policy',
      finalize: 'finalize'
    })

    .addConditionalEdges('policy', (state) => {
      if (state.status === 'POLICY_DENIED' || state.status === 'AWAITING_APPROVAL') return 'finalize';
      return 'browser_agent';
    }, {
      browser_agent: 'browser_agent',
      finalize: 'finalize'
    })

    // The actor loops on itself: per-tool policy/approval runs inside the actor and the
    // approval node, so no extra graph hop (and checkpoint write) happens between steps.
    .addConditionalEdges('browser_agent', (state) => routeAfterAct(state, maxSteps), {
      tool_approval: 'tool_approval',
      verification: 'verification',
      recovery: 'recovery',
      browser_agent: 'browser_agent',
      finalize: 'finalize'
    })

    .addConditionalEdges('tool_approval', (state) => routeAfterAct(state, maxSteps), {
      tool_approval: 'tool_approval',
      verification: 'verification',
      recovery: 'recovery',
      browser_agent: 'browser_agent',
      finalize: 'finalize'
    })

    .addConditionalEdges('verification', (state) => {
      if (state.status === 'VERIFIED') return 'jev_output_guard';
      if (state.status === 'RECOVERABLE') {
        if ((state.stepCount || 0) < maxSteps) return 'recovery';
        return 'jev_output_guard';
      }
      return 'jev_output_guard';
    }, {
      jev_output_guard: 'jev_output_guard',
      recovery: 'recovery'
    })

    .addEdge('jev_output_guard', 'finalize')

    .addConditionalEdges('recovery', (state) => {
      if (state.status === 'BLOCKED') return 'finalize';
      if (state.status === 'REPLAN_REQUIRED') return 'planner';
      return 'browser_agent';
    }, {
      finalize: 'finalize',
      planner: 'planner',
      browser_agent: 'browser_agent'
    })

    .addEdge('finalize', END);

  return workflow.compile({
    checkpointer
  });
}

/**
 * Creates a lean, direct Two-Agent StateGraph:
 * Planner Agent -> Core Browser Actor Agent -> Finalize.
 * Bypasses intermediate policy/recovery nodes for maximum throughput and lowest latency.
 */
export function createTwoAgentGraph(options = {}) {
  const model = options.model;
  const chromeApi = options.chromeApi;
  const vault = options.vault;
  const checkpointer = options.checkpointer;
  const maxSteps = options.maxSteps || 100;
  const events = options.events;

  const workflow = new StateGraph(AgentState)
    .addNode('planner', async (state) => {
      return plannerAgentNode(state, {
        model,
        useModelPlanner: options.useModelPlanner,
        events,
        maxSteps
      });
    })
    .addNode('browser_agent', async (state) => {
      return browserActorAgentNode(state, {
        model,
        chromeApi,
        vault,
        signal: options.signal,
        maxSteps,
        events,
        enableInterrupts: options.enableInterrupts,
        exposeAllTools: options.exposeAllTools
      });
    })
    .addNode('tool_approval', createToolApprovalNode({ ...options, chromeApi, vault, events, checkpointer }))
    .addNode('finalize', async (state) => {
      const isSuccess = state.latestObservation?.isFinished && state.latestObservation?.success;
      return {
        status: isSuccess ? 'COMPLETED' : 'TERMINATED',
        finalResult: {
          success: !!isSuccess,
          summary: state.latestObservation?.summary || (isSuccess ? 'Goal accomplished.' : 'Execution finished.'),
          steps: state.stepCount || 1,
          evidence: 'Browser execution completed'
        }
      };
    })

    .addEdge(START, 'planner')
    .addConditionalEdges('planner', (state) => {
      if (state.status === 'AWAITING_USER_INPUT') return 'finalize';
      return 'browser_agent';
    }, {
      browser_agent: 'browser_agent',
      finalize: 'finalize'
    })
    .addConditionalEdges('browser_agent', (state) => {
      if (state.status === 'AWAITING_TOOL_APPROVAL') return 'tool_approval';
      if ((state.stepCount || 0) >= maxSteps || state.latestObservation?.isFinished ||
          state.status === 'TASK_FINISHED_SIGNAL' || state.status === 'TERMINATED') {
        return 'finalize';
      }
      return 'browser_agent';
    }, {
      tool_approval: 'tool_approval',
      browser_agent: 'browser_agent',
      finalize: 'finalize'
    })
    .addConditionalEdges('tool_approval', (state) => {
      if (state.status === 'OPERATOR_REJECTED' || state.latestObservation?.isFinished ||
          (state.stepCount || 0) >= maxSteps) {
        return 'finalize';
      }
      return 'browser_agent';
    }, {
      browser_agent: 'browser_agent',
      finalize: 'finalize'
    })
    .addEdge('finalize', END);

  return workflow.compile({
    checkpointer
  });
}

/**
 * Returns Mermaid diagram string representing the compiled graph topology.
 */
export function getGraphMermaid(compiledApp) {
  if (typeof compiledApp?.getGraph === 'function') {
    const g = compiledApp.getGraph();
    if (typeof g.drawMermaid === 'function') {
      return g.drawMermaid();
    }
  }
  return '';
}
