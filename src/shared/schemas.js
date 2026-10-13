/**
 * PRATYAKSHA Authoritative Tool Registry & Schema System
 * Sovereign Privacy-First Browser Agent
 *
 * Single Source of Truth for all 19 browser tools.
 * Exposes Zod schemas, Gemini function declarations, OpenAI tool declarations,
 * and standard internal tool result builders.
 */

import { z } from 'zod';
import { TOOL_NAMES, TOOL_CATEGORIES, RISK_TIERS } from './constants.js';

// ─────────────────────────────────────────────────────────────────────────────
// 1. AUTHORITATIVE ZOD SCHEMAS FOR ALL 19 BROWSER TOOLS
// ─────────────────────────────────────────────────────────────────────────────

export const TOOL_ZOD_SCHEMAS = {
  [TOOL_NAMES.SEARCH_WEB]: z.object({
    query: z.string().min(1, 'Search query cannot be empty').describe('The search query to look up on the web.'),
    engine: z.enum(['google', 'bing', 'duckduckgo']).default('google').describe('Search engine to use (default: google).')
  }),

  [TOOL_NAMES.OPEN_URL]: z.object({
    url: z.string().min(1, 'URL cannot be empty').describe('The full URL to open (e.g. "https://example.com/page").'),
    rationale: z.string().optional().describe('Why you are navigating here.')
  }),

  [TOOL_NAMES.GO_BACK]: z.object({}).describe('Navigates the current tab back one page in browser history.'),

  [TOOL_NAMES.GO_FORWARD]: z.object({}).describe('Navigates the current tab forward one page in browser history.'),

  [TOOL_NAMES.SWITCH_TAB]: z.object({
    title_contains: z.string().optional().describe('Keyword that the target tab title must contain (case-insensitive).'),
    url_contains: z.string().optional().describe('Keyword that the target tab URL must contain (case-insensitive).'),
    tab_index: z.number().int().nonnegative().optional().describe('Zero-based index of the tab in the current window.')
  }),

  [TOOL_NAMES.READ_PAGE]: z.object({
    selector: z.string().optional().describe('Optional CSS selector to focus extraction on a specific section.'),
    max_chars: z.number().int().min(1).max(8000).default(4000).optional().describe('Max characters to return (default 4000, max 8000).')
  }),

  [TOOL_NAMES.GET_PAGE_METADATA]: z.object({}).describe('Returns structured metadata about the current page.'),

  [TOOL_NAMES.GET_LINKS]: z.object({
    filter: z.string().default('').optional().describe('Optional keyword — only return links matching this string.'),
    max: z.number().int().min(1).max(100).default(25).optional().describe('Maximum number of links to return (default 25).')
  }),

  [TOOL_NAMES.FIND_ON_PAGE]: z.object({
    text: z.string().min(1, 'Search text cannot be empty').describe('The text or keyword to search for on the page.'),
    case_sensitive: z.boolean().default(false).optional().describe('Whether the search is case-sensitive (default false).')
  }),

  [TOOL_NAMES.EXTRACT_STRUCTURED]: z.object({
    fields: z.array(z.object({
      name: z.string().min(1, 'Field name is required').describe('Field name'),
      selector: z.string().min(1, 'CSS selector is required').describe('CSS selector'),
      attribute: z.string().optional().describe('Optional attribute (e.g. href, src)')
    })).min(1, 'At least one field is required for structured extraction').describe('List of fields to extract.'),
    root_selector: z.string().optional().describe('Optional CSS selector to scope extraction to a specific container.')
  }),

  [TOOL_NAMES.CLICK_ELEMENT]: z.object({
    target_id: z.union([z.number().int(), z.string().regex(/^\d+$/)]).optional().describe('Numeric [ID] from the DOM elements table.'),
    semantic_hint: z.string().optional().describe('Fallback: describe the element.')
  }).refine(data => data.target_id !== undefined || !!data.semantic_hint, {
    message: 'click_element requires either target_id or semantic_hint'
  }),

  [TOOL_NAMES.TYPE_INTO_ELEMENT]: z.object({
    target_id: z.union([z.number().int(), z.string().regex(/^\d+$/)]).optional().describe('Numeric [ID] from the DOM elements table.'),
    semantic_hint: z.string().optional().describe('Fallback: describe the field.'),
    text: z.string().describe('The exact text to type.'),
    clear_first: z.boolean().default(false).optional().describe('Clear existing content before typing (default false).'),
    press_enter: z.boolean().default(false).optional().describe('Press Enter after typing (for search bars and forms).')
  }).refine(data => data.target_id !== undefined || !!data.semantic_hint, {
    message: 'type_into_element requires either target_id or semantic_hint'
  }),

  [TOOL_NAMES.EXECUTE_JS]: z.object({
    code: z.string().min(1, 'JavaScript code cannot be empty').describe('JavaScript expression or statement to execute in page context.'),
    description: z.string().optional().describe('What this JS is intended to do.')
  }),

  [TOOL_NAMES.INSPECT_DOM]: z.object({
    target_id: z.union([z.number().int(), z.string().regex(/^\d+$/)]).optional().describe('Numeric [ID] from the DOM elements table.'),
    selector: z.string().optional().describe('CSS selector to inspect an element not in the table.'),
    semantic_hint: z.string().optional().describe('Describe the element if selector/id unavailable.')
  }),

  [TOOL_NAMES.SCREENSHOT]: z.object({}).describe('Captures a screenshot of the current visible viewport.'),

  [TOOL_NAMES.SCROLL_PAGE]: z.object({
    direction: z.enum(['down', 'up', 'top', 'bottom']).describe('Scroll direction.'),
    pixels: z.number().min(1).max(5000).default(600).optional().describe('Pixels to scroll (for "down"/"up"). Default 600.')
  }),

  [TOOL_NAMES.WAIT_FOR]: z.object({
    selector: z.string().optional().describe('CSS selector to wait for.'),
    text_contains: z.string().optional().describe('Text that must appear on the page.'),
    timeout_seconds: z.number().min(1).max(30).default(8).optional().describe('Max seconds to wait (default 8, max 30).')
  }).refine(data => !!data.selector || !!data.text_contains, {
    message: 'wait_for requires either selector or text_contains'
  }),

  [TOOL_NAMES.WAIT_SECONDS]: z.object({
    seconds: z.number().min(0.5).max(10).describe('Seconds to wait (0.5–10).'),
    reason: z.string().optional().describe('Why you are waiting.')
  }),

  [TOOL_NAMES.FINISH_TASK]: z.object({
    summary: z.string().min(1, 'Summary is required').describe('Detailed summary of what was accomplished.'),
    success: z.boolean().describe('true if goal achieved, false only if impossible after exhausting all options.')
  })
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. AUTHORITATIVE TOOL SPECIFICATIONS REGISTRY (19 TOOLS)
// ─────────────────────────────────────────────────────────────────────────────

export const BROWSER_TOOL_SPECS = [
  {
    name: TOOL_NAMES.SEARCH_WEB,
    description: 'Searches the web for fresh information using a query string. Navigates to Google/Bing/DDG, waits for results, and returns the extracted result text.',
    category: TOOL_CATEGORIES.NAVIGATION,
    defaultRisk: RISK_TIERS.READ_ONLY,
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: 'The search query to look up on the web.' },
        engine: { type: 'STRING', enum: ['google', 'bing', 'duckduckgo'], description: 'Search engine to use (default: google).' }
      },
      required: ['query']
    }
  },
  {
    name: TOOL_NAMES.OPEN_URL,
    description: 'Opens an exact URL in the current tab. Use this when you already know the destination URL. For searches use search_web instead.',
    category: TOOL_CATEGORIES.NAVIGATION,
    defaultRisk: RISK_TIERS.REVERSIBLE,
    parameters: {
      type: 'OBJECT',
      properties: {
        url: { type: 'STRING', description: 'The full URL to open (e.g. "https://example.com/page").' },
        rationale: { type: 'STRING', description: 'Why you are navigating here.' }
      },
      required: ['url']
    }
  },
  {
    name: TOOL_NAMES.GO_BACK,
    description: 'Navigates the current tab back one page in browser history. Use for recovery or to return to a previous state.',
    category: TOOL_CATEGORIES.NAVIGATION,
    defaultRisk: RISK_TIERS.REVERSIBLE,
    parameters: { type: 'OBJECT', properties: {}, required: [] }
  },
  {
    name: TOOL_NAMES.GO_FORWARD,
    description: 'Navigates the current tab forward one page in browser history.',
    category: TOOL_CATEGORIES.NAVIGATION,
    defaultRisk: RISK_TIERS.REVERSIBLE,
    parameters: { type: 'OBJECT', properties: {}, required: [] }
  },
  {
    name: TOOL_NAMES.SWITCH_TAB,
    description: 'Switches the active browser tab by matching a title keyword or URL keyword. Use for multi-tab research workflows.',
    category: TOOL_CATEGORIES.NAVIGATION,
    defaultRisk: RISK_TIERS.REVERSIBLE,
    parameters: {
      type: 'OBJECT',
      properties: {
        title_contains: { type: 'STRING', description: 'Keyword that the target tab title must contain (case-insensitive).' },
        url_contains: { type: 'STRING', description: 'Keyword that the target tab URL must contain (case-insensitive).' },
        tab_index: { type: 'NUMBER', description: 'Zero-based index of the tab in the current window.' }
      },
      required: []
    }
  },
  {
    name: TOOL_NAMES.READ_PAGE,
    description: 'Reads and extracts the visible text content of the current page. Optionally focus on a specific CSS region.',
    category: TOOL_CATEGORIES.READING,
    defaultRisk: RISK_TIERS.READ_ONLY,
    parameters: {
      type: 'OBJECT',
      properties: {
        selector: { type: 'STRING', description: 'Optional CSS selector to focus extraction on a specific section.' },
        max_chars: { type: 'NUMBER', description: 'Max characters to return (default 4000, max 8000).' }
      },
      required: []
    }
  },
  {
    name: TOOL_NAMES.GET_PAGE_METADATA,
    description: 'Returns structured metadata about the current page: title, URL, canonical, meta description, Open Graph tags.',
    category: TOOL_CATEGORIES.READING,
    defaultRisk: RISK_TIERS.READ_ONLY,
    parameters: { type: 'OBJECT', properties: {}, required: [] }
  },
  {
    name: TOOL_NAMES.GET_LINKS,
    description: 'Returns all hyperlinks on the page as a list of {text, url} pairs. Optionally filter by keyword.',
    category: TOOL_CATEGORIES.READING,
    defaultRisk: RISK_TIERS.READ_ONLY,
    parameters: {
      type: 'OBJECT',
      properties: {
        filter: { type: 'STRING', description: 'Optional keyword — only return links whose text or URL contain this string.' },
        max: { type: 'NUMBER', description: 'Maximum number of links to return (default 25).' }
      },
      required: []
    }
  },
  {
    name: TOOL_NAMES.FIND_ON_PAGE,
    description: 'Searches for a text string on the current page. Returns whether it was found, match count, context, and scrolls to first match.',
    category: TOOL_CATEGORIES.READING,
    defaultRisk: RISK_TIERS.READ_ONLY,
    parameters: {
      type: 'OBJECT',
      properties: {
        text: { type: 'STRING', description: 'The text or keyword to search for on the page.' },
        case_sensitive: { type: 'BOOLEAN', description: 'Whether the search is case-sensitive (default false).' }
      },
      required: ['text']
    }
  },
  {
    name: TOOL_NAMES.EXTRACT_STRUCTURED,
    description: 'Extracts structured data from the page into a JSON object based on a list of field selectors.',
    category: TOOL_CATEGORIES.READING,
    defaultRisk: RISK_TIERS.READ_ONLY,
    parameters: {
      type: 'OBJECT',
      properties: {
        fields: {
          type: 'ARRAY',
          description: 'List of fields to extract.',
          items: {
            type: 'OBJECT',
            properties: {
              name: { type: 'STRING', description: 'Field name' },
              selector: { type: 'STRING', description: 'CSS selector' },
              attribute: { type: 'STRING', description: 'Optional attribute (e.g. href, src)' }
            },
            required: ['name', 'selector']
          }
        },
        root_selector: { type: 'STRING', description: 'Optional CSS selector to scope extraction to a specific container.' }
      },
      required: ['fields']
    }
  },
  {
    name: TOOL_NAMES.CLICK_ELEMENT,
    description: 'Clicks an interactive element — buttons, links, tabs, checkboxes. Use target_id from the DOM table for accuracy.',
    category: TOOL_CATEGORIES.INTERACTION,
    defaultRisk: RISK_TIERS.REVERSIBLE,
    parameters: {
      type: 'OBJECT',
      properties: {
        target_id: { type: 'NUMBER', description: 'Numeric [ID] from the DOM elements table. Preferred for guaranteed accuracy.' },
        semantic_hint: { type: 'STRING', description: 'Fallback: describe the element (e.g. "Compose button").' }
      },
      required: []
    }
  },
  {
    name: TOOL_NAMES.TYPE_INTO_ELEMENT,
    description: 'Types text into any input, search bar, textarea, or rich-text editor. Use target_id from the DOM table.',
    category: TOOL_CATEGORIES.INTERACTION,
    defaultRisk: RISK_TIERS.SENSITIVE,
    parameters: {
      type: 'OBJECT',
      properties: {
        target_id: { type: 'NUMBER', description: 'Numeric [ID] from the DOM elements table.' },
        semantic_hint: { type: 'STRING', description: 'Fallback: describe the field.' },
        text: { type: 'STRING', description: 'The exact text to type.' },
        clear_first: { type: 'BOOLEAN', description: 'Clear existing content before typing (default false).' },
        press_enter: { type: 'BOOLEAN', description: 'Press Enter after typing.' }
      },
      required: ['text']
    }
  },
  {
    name: TOOL_NAMES.EXECUTE_JS,
    description: 'Executes arbitrary JavaScript in the context of the current page and returns the result. Privileged operation.',
    category: TOOL_CATEGORIES.INTERACTION,
    defaultRisk: RISK_TIERS.RESTRICTED,
    parameters: {
      type: 'OBJECT',
      properties: {
        code: { type: 'STRING', description: 'JavaScript expression or statement to execute in the page context.' },
        description: { type: 'STRING', description: 'What this JS is intended to do.' }
      },
      required: ['code']
    }
  },
  {
    name: TOOL_NAMES.INSPECT_DOM,
    description: 'Inspects a specific DOM element and returns its accessibility info, attributes, role, and nearby children.',
    category: TOOL_CATEGORIES.OBSERVATION,
    defaultRisk: RISK_TIERS.READ_ONLY,
    parameters: {
      type: 'OBJECT',
      properties: {
        target_id: { type: 'NUMBER', description: 'Numeric [ID] from the DOM elements table.' },
        selector: { type: 'STRING', description: 'CSS selector to inspect an element not in the table.' },
        semantic_hint: { type: 'STRING', description: 'Describe the element if selector/id unavailable.' }
      },
      required: []
    }
  },
  {
    name: TOOL_NAMES.SCREENSHOT,
    description: 'Captures a screenshot of the current visible viewport. Returns page title and dimensions.',
    category: TOOL_CATEGORIES.OBSERVATION,
    defaultRisk: RISK_TIERS.READ_ONLY,
    parameters: { type: 'OBJECT', properties: {}, required: [] }
  },
  {
    name: TOOL_NAMES.SCROLL_PAGE,
    description: 'Scrolls the viewport to reveal more content, load lazy elements, or navigate to a specific position.',
    category: TOOL_CATEGORIES.OBSERVATION,
    defaultRisk: RISK_TIERS.READ_ONLY,
    parameters: {
      type: 'OBJECT',
      properties: {
        direction: { type: 'STRING', enum: ['down', 'up', 'top', 'bottom'], description: 'Direction to scroll.' },
        pixels: { type: 'NUMBER', description: 'Pixels to scroll (for "down"/"up"). Default 600.' }
      },
      required: ['direction']
    }
  },
  {
    name: TOOL_NAMES.WAIT_FOR,
    description: 'Waits until a specific element appears in the DOM or specific text becomes visible on the page.',
    category: TOOL_CATEGORIES.WAITING,
    defaultRisk: RISK_TIERS.READ_ONLY,
    parameters: {
      type: 'OBJECT',
      properties: {
        selector: { type: 'STRING', description: 'CSS selector to wait for.' },
        text_contains: { type: 'STRING', description: 'Text that must appear on the page.' },
        timeout_seconds: { type: 'NUMBER', description: 'Max seconds to wait (default 8, max 30).' }
      },
      required: []
    }
  },
  {
    name: TOOL_NAMES.WAIT_SECONDS,
    description: 'Pauses for N seconds to let animations, modals, AJAX requests, or page transitions finish.',
    category: TOOL_CATEGORIES.WAITING,
    defaultRisk: RISK_TIERS.READ_ONLY,
    parameters: {
      type: 'OBJECT',
      properties: {
        seconds: { type: 'NUMBER', description: 'Seconds to wait (0.5–10).' },
        reason: { type: 'STRING', description: 'Why you are waiting.' }
      },
      required: ['seconds']
    }
  },
  {
    name: TOOL_NAMES.FINISH_TASK,
    description: 'Marks the task complete with a detailed summary. Call ONLY when the user goal is fully achieved and verified.',
    category: TOOL_CATEGORIES.COMPLETION,
    defaultRisk: RISK_TIERS.READ_ONLY,
    parameters: {
      type: 'OBJECT',
      properties: {
        summary: { type: 'STRING', description: 'Detailed summary of what was accomplished.' },
        success: { type: 'BOOLEAN', description: 'true if goal achieved, false only if impossible after exhausting all options.' }
      },
      required: ['summary', 'success']
    }
  }
];

// ─────────────────────────────────────────────────────────────────────────────
// 3. SCHEMA CONVERTERS
// ─────────────────────────────────────────────────────────────────────────────

function toOpenAiType(type) {
  if (!type) return 'string';
  const t = String(type).toUpperCase();
  switch (t) {
    case 'STRING':  return 'string';
    case 'NUMBER':  return 'number';
    case 'INTEGER': return 'integer';
    case 'BOOLEAN': return 'boolean';
    case 'OBJECT':  return 'object';
    case 'ARRAY':   return 'array';
    default:        return t.toLowerCase();
  }
}

export function jsonSchemaPropToOpenAi(prop) {
  if (!prop) return {};
  const out = {
    type: toOpenAiType(prop.type)
  };
  if (prop.description) out.description = prop.description;
  if (Array.isArray(prop.enum)) out.enum = prop.enum;

  if (prop.items) {
    out.items = jsonSchemaPropToOpenAi(prop.items);
  }

  if (prop.properties && typeof prop.properties === 'object') {
    out.properties = Object.fromEntries(
      Object.entries(prop.properties).map(([k, v]) => [k, jsonSchemaPropToOpenAi(v)])
    );
  }

  if (Array.isArray(prop.required) && prop.required.length > 0) {
    out.required = prop.required;
  }

  return out;
}

/**
 * Returns Gemini function declarations array (used by Gemini VLM)
 */
export function getGeminiToolDeclarations() {
  return BROWSER_TOOL_SPECS.map(spec => ({
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters
  }));
}

/**
 * Returns OpenAI-format function declarations array (used by Mistral and OpenRouter)
 */
export function getOpenAiToolDeclarations() {
  return BROWSER_TOOL_SPECS.map(spec => ({
    type: 'function',
    function: {
      name: spec.name,
      description: spec.description,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(spec.parameters.properties || {}).map(([k, v]) => [k, jsonSchemaPropToOpenAi(v)])
        ),
        required: spec.parameters.required || []
      }
    }
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. STANDARD TOOL RESULT CONTRACT BUILDERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a normalized successful tool result adhering to the system contract.
 */
export function createToolResult({
  ok = true,
  toolName,
  observation = '',
  page = {},
  metadata = {},
  newTabId = null,
  screenshotDataUrl = null,
  isFinished = false,
  success = true,
  summary = null
}) {
  return {
    ok: !!ok,
    toolName: String(toolName || 'unknown'),
    observation: String(observation || ''),
    page: {
      url: page.url || '',
      title: page.title || '',
      id: page.id || null
    },
    metadata: { ...metadata },
    newTabId: newTabId !== null ? Number(newTabId) : null,
    screenshotDataUrl: screenshotDataUrl || null,
    isFinished: !!isFinished,
    success: !!success,
    summary: summary || null,
    error: null,
    timestamp: Date.now()
  };
}

/**
 * Creates a normalized error tool result adhering to the system contract.
 */
export function createToolError({
  toolName,
  error,
  page = {},
  metadata = {},
  recoverable = true
}) {
  const message = error instanceof Error ? error.message : String(error || 'Unknown error');
  const code = error?.code || 'TOOL_EXECUTION_ERROR';

  return {
    ok: false,
    toolName: String(toolName || 'unknown'),
    observation: `ERROR [${toolName}]: ${message}`,
    page: {
      url: page.url || '',
      title: page.title || '',
      id: page.id || null
    },
    metadata: { ...metadata },
    newTabId: null,
    screenshotDataUrl: null,
    isFinished: false,
    success: false,
    summary: null,
    error: {
      message,
      code,
      recoverable: recoverable !== false,
      details: error?.details || {}
    },
    timestamp: Date.now()
  };
}

/**
 * Normalizes tool name aliases and argument variations produced by different LLMs.
 */
export function normalizeToolInvocation(toolName = '', rawArgs = {}) {
  const TOOL_ALIASES = {
    click: TOOL_NAMES.CLICK_ELEMENT,
    click_button: TOOL_NAMES.CLICK_ELEMENT,
    clickelement: TOOL_NAMES.CLICK_ELEMENT,
    type: TOOL_NAMES.TYPE_INTO_ELEMENT,
    type_text: TOOL_NAMES.TYPE_INTO_ELEMENT,
    input: TOOL_NAMES.TYPE_INTO_ELEMENT,
    input_text: TOOL_NAMES.TYPE_INTO_ELEMENT,
    typeintoelement: TOOL_NAMES.TYPE_INTO_ELEMENT,
    open: TOOL_NAMES.OPEN_URL,
    goto: TOOL_NAMES.OPEN_URL,
    navigate: TOOL_NAMES.OPEN_URL,
    navigate_to: TOOL_NAMES.OPEN_URL,
    openurl: TOOL_NAMES.OPEN_URL,
    search: TOOL_NAMES.SEARCH_WEB,
    web_search: TOOL_NAMES.SEARCH_WEB,
    google_search: TOOL_NAMES.SEARCH_WEB,
    searchweb: TOOL_NAMES.SEARCH_WEB,
    read: TOOL_NAMES.READ_PAGE,
    readpage: TOOL_NAMES.READ_PAGE,
    extract: TOOL_NAMES.READ_PAGE,
    scroll: TOOL_NAMES.SCROLL_PAGE,
    scrollpage: TOOL_NAMES.SCROLL_PAGE,
    finish: TOOL_NAMES.FINISH_TASK,
    complete: TOOL_NAMES.FINISH_TASK,
    done: TOOL_NAMES.FINISH_TASK,
    finishtask: TOOL_NAMES.FINISH_TASK
  };

  const lower = String(toolName || '').toLowerCase().trim();
  const canonicalName = TOOL_ALIASES[lower] || toolName;
  const args = { ...rawArgs };

  if (canonicalName === TOOL_NAMES.CLICK_ELEMENT) {
    if (args.target_id === undefined) {
      const rawTarget = args.id ?? args.target ?? args.element_id ?? args.targetId;
      if (rawTarget !== undefined) {
        const num = Number(rawTarget);
        if (Number.isFinite(num) && num > 0) {
          args.target_id = num;
        } else {
          args.semantic_hint = args.semantic_hint || String(rawTarget);
        }
      }
    } else if (typeof args.target_id === 'string' && !/^\d+$/.test(args.target_id)) {
      args.semantic_hint = args.semantic_hint || args.target_id;
      delete args.target_id;
    }
  } else if (canonicalName === TOOL_NAMES.TYPE_INTO_ELEMENT) {
    if (args.target_id === undefined) {
      const rawTarget = args.id ?? args.target ?? args.element_id ?? args.targetId;
      if (rawTarget !== undefined) {
        const num = Number(rawTarget);
        if (Number.isFinite(num) && num > 0) {
          args.target_id = num;
        } else {
          args.semantic_hint = args.semantic_hint || String(rawTarget);
        }
      }
    } else if (typeof args.target_id === 'string' && !/^\d+$/.test(args.target_id)) {
      args.semantic_hint = args.semantic_hint || args.target_id;
      delete args.target_id;
    }
    if (args.text === undefined && args.value !== undefined) {
      args.text = String(args.value);
    }
  } else if (canonicalName === TOOL_NAMES.OPEN_URL) {
    if (!args.url && args.link) args.url = args.link;
    if (!args.url && args.destination) args.url = args.destination;
  } else if (canonicalName === TOOL_NAMES.SEARCH_WEB) {
    if (!args.query && args.q) args.query = args.q;
    if (!args.query && args.text) args.query = args.text;
  } else if (canonicalName === TOOL_NAMES.FINISH_TASK) {
    if (!args.summary && args.message) args.summary = args.message;
    if (!args.summary && args.result) args.summary = args.result;
    if (!args.summary && args.output) args.summary = args.output;
  }

  return { toolName: canonicalName, args };
}

/**
 * Validates tool arguments against the authoritative Zod schema.
 */
export function validateToolArgs(toolName, rawArgs = {}) {
  const { toolName: canonicalName, args } = normalizeToolInvocation(toolName, rawArgs);
  const schema = TOOL_ZOD_SCHEMAS[canonicalName];
  if (!schema) {
    throw new Error(`Unregistered tool: "${toolName}"`);
  }
  return schema.parse(args);
}
