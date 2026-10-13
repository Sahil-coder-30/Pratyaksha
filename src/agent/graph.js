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
import { AgentState } from './state.js';
import { anonymizeInputTask } from '../safety/privacy.js';
import { plannerAgentNode, createPlannerAgent } from './planner-agent.js';
import { browserActorAgentNode, createBrowserActorAgent } from './browser-actor-agent.js';
import { classifyAction } from '../safety/action-policy.js';
import { createApprovalRequest } from '../safety/approval.js';
import { verifierNode } from './verifier.js';
import { recoveryNode } from './recovery.js';
import { TOOL_NAMES } from '../shared/constants.js';

export { createPlannerAgent, createBrowserActorAgent };

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

    // ── 3. PLANNER AGENT NODE (Independent Module) ───────────────────────────
    .addNode('planner', async (state) => {
      return plannerAgentNode(state, {
        model,
        useModelPlanner: options.useModelPlanner,
        events,
        maxSteps
      });
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
        events
      });
    })

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

    // ── 8. FINALIZE NODE ──────────────────────────────────────────────────────
    .addNode('finalize', async (state) => {
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
        if (state.error?.message) {
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
    .addEdge('privacy', 'planner')

    .addConditionalEdges('planner', (state) => {
      if (state.status === 'AWAITING_USER_INPUT') return 'finalize';
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

    .addConditionalEdges('browser_agent', (state) => {
      if ((state.stepCount || 0) >= maxSteps) return 'verification';

      if (state.latestObservation?.isFinished || state.status === 'TASK_FINISHED_SIGNAL') {
        return 'verification';
      }

      if (state.status === 'TOOL_ERROR') {
        return 'recovery';
      }

      return 'policy';
    }, {
      verification: 'verification',
      recovery: 'recovery',
      policy: 'policy'
    })

    .addConditionalEdges('verification', (state) => {
      if (state.status === 'VERIFIED') return 'finalize';
      if (state.status === 'RECOVERABLE') {
        if ((state.stepCount || 0) < maxSteps) return 'recovery';
        return 'finalize';
      }
      return 'finalize';
    }, {
      finalize: 'finalize',
      recovery: 'recovery'
    })

    .addConditionalEdges('recovery', (state) => {
      if (state.status === 'BLOCKED') return 'finalize';
      if (state.status === 'REPLAN_REQUIRED') return 'planner';
      return 'policy';
    }, {
      finalize: 'finalize',
      planner: 'planner',
      policy: 'policy'
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
        events
      });
    })
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
      if ((state.stepCount || 0) >= maxSteps || state.latestObservation?.isFinished || state.status === 'TASK_FINISHED_SIGNAL') {
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
