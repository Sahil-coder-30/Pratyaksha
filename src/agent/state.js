/**
 * PRATYAKSHA LangGraph State Definition
 * Sovereign Privacy-First Browser Agent
 *
 * Defines the authoritative state channels, type reducers, and initializers
 * for the outer LangGraph workflow.
 */

import { Annotation, messagesStateReducer } from '@langchain/langgraph';

// Reducer replacing value with new update if defined, otherwise keeping existing
const replaceReducer = (current, update) => (update !== undefined ? update : current);

// Reducer appending items to a list
const appendListReducer = (current, update) => {
  if (!update) return current || [];
  if (Array.isArray(update)) return [...(current || []), ...update];
  return [...(current || []), update];
};

export const AgentState = Annotation.Root({
  // Task & Identity
  threadId: Annotation({ reducer: replaceReducer, default: () => '' }),
  taskId: Annotation({ reducer: replaceReducer, default: () => '' }),
  originalTask: Annotation({ reducer: replaceReducer, default: () => '' }),
  sanitizedTask: Annotation({ reducer: replaceReducer, default: () => '' }),

  // Conversation & Execution History
  messages: Annotation({ reducer: messagesStateReducer, default: () => [] }),

  // Planning & Execution State
  plan: Annotation({ reducer: replaceReducer, default: () => null }),
  currentSubgoalIndex: Annotation({ reducer: replaceReducer, default: () => 0 }),
  completedSubgoals: Annotation({ reducer: appendListReducer, default: () => [] }),

  // Browser Context & Observations
  browserSession: Annotation({ reducer: replaceReducer, default: () => ({ tabId: null, url: '', title: '' }) }),
  latestObservation: Annotation({ reducer: replaceReducer, default: () => null }),
  domTable: Annotation({ reducer: replaceReducer, default: () => '' }),
  blacklistedTargets: Annotation({
    reducer: (current, update) => {
      const set = new Set(current || []);
      if (Array.isArray(update)) {
        update.forEach(id => set.add(Number(id)));
      } else if (update !== undefined && update !== null) {
        set.add(Number(update));
      }
      return Array.from(set);
    },
    default: () => []
  }),

  // Verification & Recovery State
  verificationResult: Annotation({ reducer: replaceReducer, default: () => null }),
  recoveryCount: Annotation({ reducer: replaceReducer, default: () => 0 }),
  stepCount: Annotation({ reducer: (current, update) => (typeof update === 'number' ? update : (current || 0) + 1), default: () => 0 }),

  // Safety & Human-in-the-Loop Approval
  approvalStatus: Annotation({ reducer: replaceReducer, default: () => 'NONE' }),
  pendingApproval: Annotation({ reducer: replaceReducer, default: () => null }),
  planApprovalStatus: Annotation({ reducer: replaceReducer, default: () => 'NONE' }),
  pendingPlanApproval: Annotation({ reducer: replaceReducer, default: () => null }),
  jevInputResult: Annotation({ reducer: replaceReducer, default: () => null }),
  jevOutputResult: Annotation({ reducer: replaceReducer, default: () => null }),

  // Workflow Outcome
  status: Annotation({ reducer: replaceReducer, default: () => 'IDLE' }),
  finalResult: Annotation({ reducer: replaceReducer, default: () => null }),
  error: Annotation({ reducer: replaceReducer, default: () => null })
});
