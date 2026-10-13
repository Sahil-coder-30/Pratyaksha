/**
 * PRATYAKSHA Shared Constants
 * Sovereign Privacy-First Browser Agent
 */

export const RISK_TIERS = Object.freeze({
  READ_ONLY: 'READ_ONLY',         // Safe page extraction, inspection, search
  REVERSIBLE: 'REVERSIBLE',       // Navigation, scrolling, clicking normal links
  SENSITIVE: 'SENSITIVE',         // Form typing, logins, settings toggles
  IRREVERSIBLE: 'IRREVERSIBLE',   // Sending messages, transactions, deletes
  RESTRICTED: 'RESTRICTED'        // Privileged operations (e.g. arbitrary execute_js, dangerous protocols)
});

export const TOOL_CATEGORIES = Object.freeze({
  NAVIGATION: 'NAVIGATION',
  READING: 'READING',
  INTERACTION: 'INTERACTION',
  OBSERVATION: 'OBSERVATION',
  WAITING: 'WAITING',
  COMPLETION: 'COMPLETION'
});

export const TOOL_NAMES = Object.freeze({
  SEARCH_WEB: 'search_web',
  OPEN_URL: 'open_url',
  GO_BACK: 'go_back',
  GO_FORWARD: 'go_forward',
  SWITCH_TAB: 'switch_tab',
  READ_PAGE: 'read_page',
  GET_PAGE_METADATA: 'get_page_metadata',
  GET_LINKS: 'get_links',
  FIND_ON_PAGE: 'find_on_page',
  EXTRACT_STRUCTURED: 'extract_structured',
  CLICK_ELEMENT: 'click_element',
  TYPE_INTO_ELEMENT: 'type_into_element',
  EXECUTE_JS: 'execute_js',
  INSPECT_DOM: 'inspect_dom',
  SCREENSHOT: 'screenshot',
  SCROLL_PAGE: 'scroll_page',
  WAIT_FOR: 'wait_for',
  WAIT_SECONDS: 'wait_seconds',
  FINISH_TASK: 'finish_task'
});

export const CANONICAL_SERVICES = Object.freeze([
  { pattern: /\bgmail\b/i, url: 'https://mail.google.com', name: 'Gmail', hostMatch: /mail\.google\.com/i },
  { pattern: /\byoutube\b/i, url: 'https://www.youtube.com', name: 'YouTube', hostMatch: /youtube\.com/i },
  { pattern: /\bgithub\b/i, url: 'https://github.com', name: 'GitHub', hostMatch: /github\.com/i },
  { pattern: /\b(cricbuzz|cricket score)\b/i, url: 'https://www.cricbuzz.com', name: 'Cricbuzz', hostMatch: /cricbuzz\.com/i },
  { pattern: /\bwikipedia\b/i, url: 'https://www.wikipedia.org', name: 'Wikipedia', hostMatch: /wikipedia\.org/i },
  { pattern: /\b(twitter|x\.com)\b/i, url: 'https://x.com', name: 'Twitter/X', hostMatch: /x\.com|twitter\.com/i },
  { pattern: /\breddit\b/i, url: 'https://www.reddit.com', name: 'Reddit', hostMatch: /reddit\.com/i },
  { pattern: /\b(google search|google\.com)\b/i, url: 'https://www.google.com', name: 'Google', hostMatch: /google\.com/i }
]);

export const FORBIDDEN_URL_PROTOCOLS = Object.freeze([
  'chrome:',
  'chrome-extension:',
  'edge:',
  'about:',
  'data:',
  'javascript:',
  'vbscript:',
  'devtools:'
]);
