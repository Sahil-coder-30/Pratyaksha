/**
 * PRATYAKSHA Agent Re-export Facade
 * Provides backward compatibility redirecting to browser-actor-agent.js
 */

export {
  BROWSER_ACTOR_SYSTEM_PROMPT as buildAgentSystemPrompt,
  browserActorAgentNode as browserAgentTurn,
  createBrowserActorAgent,
  browserActorAgentNode
} from './browser-actor-agent.js';
