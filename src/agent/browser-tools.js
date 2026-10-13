/**
 * PRATYAKSHA LangChain Browser Tool Adapters
 * Sovereign Privacy-First Browser Agent
 *
 * Wraps authoritative browser tool operations into standard LangChain tools
 * with Zod schema validation, session tab context binding, and privacy rehydration.
 */

import { tool } from '@langchain/core/tools';
import { BROWSER_TOOL_SPECS, TOOL_ZOD_SCHEMAS } from '../shared/schemas.js';
import { executeBrowserTool } from '../browser/browser-tools.js';
import { TOOL_NAMES } from '../shared/constants.js';

/**
 * Creates LangChain-compatible tools bound to a browser session context provider.
 *
 * @param {Function} getSessionContext Function returning { activeTab, vault, signal, chromeApi, onToolResult }
 * @param {Object} [options]
 * @param {boolean} [options.includeFinishTask=true] Whether to expose finish_task to the model
 * @returns {Array<Object>} Array of LangChain StructuredTools
 */
export function createLangChainBrowserTools(getSessionContext, options = {}) {
  const includeFinish = options.includeFinishTask !== false;

  const tools = [];

  for (const spec of BROWSER_TOOL_SPECS) {
    if (spec.name === TOOL_NAMES.FINISH_TASK && !includeFinish) {
      continue;
    }

    const schema = TOOL_ZOD_SCHEMAS[spec.name];
    if (!schema) {
      console.warn(`[PRATYAKSHA] No Zod schema found for tool "${spec.name}", skipping.`);
      continue;
    }

    const toolName = spec.name;
    const toolDescription = spec.description;

    const lcTool = tool(async (inputArgs) => {
      const session = typeof getSessionContext === 'function' ? getSessionContext() : getSessionContext;
      const activeTab = session?.activeTab;
      const vault = session?.vault;
      const signal = session?.signal;
      const chromeApi = session?.chromeApi;

      const result = await executeBrowserTool(toolName, inputArgs, activeTab, {
        vault,
        signal,
        chromeApi
      });

      if (result.newTabId && activeTab) {
        activeTab.id = result.newTabId;
      }

      if (session?.onToolResult) {
        session.onToolResult(result);
      }

      return result.observation;
    }, {
      name: toolName,
      description: toolDescription,
      schema
    });

    tools.push(lcTool);
  }

  return tools;
}
