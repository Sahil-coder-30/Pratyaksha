/**
 * PRATYAKSHA Test Suite: Tool Registry & Schema Contracts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BROWSER_TOOL_SPECS,
  TOOL_ZOD_SCHEMAS,
  validateToolArgs,
  getGeminiToolDeclarations,
  getOpenAiToolDeclarations,
  createToolResult,
  createToolError
} from '../src/shared/schemas.js';
import { TOOL_NAMES, RISK_TIERS, TOOL_CATEGORIES } from '../src/shared/constants.js';

test('Tool Registry - Integrity & Completeness', (t) => {
  assert.equal(BROWSER_TOOL_SPECS.length, 19, 'Must have exactly 19 authoritative tools');
  assert.equal(Object.keys(TOOL_ZOD_SCHEMAS).length, 19, 'All 19 tools must have a Zod schema');

  for (const spec of BROWSER_TOOL_SPECS) {
    assert.ok(spec.name, 'Tool must have a name');
    assert.ok(spec.description, `Tool ${spec.name} must have a description`);
    assert.ok(spec.category in TOOL_CATEGORIES, `Tool ${spec.name} has valid category`);
    assert.ok(spec.defaultRisk in RISK_TIERS, `Tool ${spec.name} has valid defaultRisk`);
    assert.ok(TOOL_ZOD_SCHEMAS[spec.name], `Tool ${spec.name} must have matching Zod schema`);
    assert.ok(spec.parameters, `Tool ${spec.name} must have parameters`);
  }
});

test('Schema Validation - Valid Arguments', () => {
  // search_web
  const sw = validateToolArgs(TOOL_NAMES.SEARCH_WEB, { query: 'test query', engine: 'bing' });
  assert.equal(sw.query, 'test query');
  assert.equal(sw.engine, 'bing');

  // open_url
  const ou = validateToolArgs(TOOL_NAMES.OPEN_URL, { url: 'https://example.com', rationale: 'testing' });
  assert.equal(ou.url, 'https://example.com');

  // click_element - numeric ID
  const ceNum = validateToolArgs(TOOL_NAMES.CLICK_ELEMENT, { target_id: 15 });
  assert.equal(ceNum.target_id, 15);

  // click_element - string ID accepted
  const ceStr = validateToolArgs(TOOL_NAMES.CLICK_ELEMENT, { target_id: '42' });
  assert.equal(Number(ceStr.target_id), 42);

  // click_element - semantic_hint fallback
  const ceHint = validateToolArgs(TOOL_NAMES.CLICK_ELEMENT, { semantic_hint: 'Submit button' });
  assert.equal(ceHint.semantic_hint, 'Submit button');

  // type_into_element
  const typeRes = validateToolArgs(TOOL_NAMES.TYPE_INTO_ELEMENT, {
    target_id: 3,
    text: 'sample text',
    clear_first: true,
    press_enter: true
  });
  assert.equal(typeRes.text, 'sample text');
  assert.equal(typeRes.clear_first, true);
  assert.equal(typeRes.press_enter, true);

  // extract_structured
  const es = validateToolArgs(TOOL_NAMES.EXTRACT_STRUCTURED, {
    fields: [
      { name: 'headline', selector: 'h1' },
      { name: 'link', selector: 'a', attribute: 'href' }
    ]
  });
  assert.equal(es.fields.length, 2);
  assert.equal(es.fields[0].name, 'headline');

  // finish_task
  const ft = validateToolArgs(TOOL_NAMES.FINISH_TASK, { summary: 'Completed goal', success: true });
  assert.equal(ft.success, true);
});

test('Schema Validation - Rejection of Invalid Arguments', () => {
  // search_web missing query
  assert.throws(() => {
    validateToolArgs(TOOL_NAMES.SEARCH_WEB, {});
  });

  // open_url missing url
  assert.throws(() => {
    validateToolArgs(TOOL_NAMES.OPEN_URL, {});
  });

  // click_element without target_id and without semantic_hint
  assert.throws(() => {
    validateToolArgs(TOOL_NAMES.CLICK_ELEMENT, {});
  });

  // type_into_element missing text
  assert.throws(() => {
    validateToolArgs(TOOL_NAMES.TYPE_INTO_ELEMENT, { target_id: 5 });
  });

  // extract_structured empty fields array
  assert.throws(() => {
    validateToolArgs(TOOL_NAMES.EXTRACT_STRUCTURED, { fields: [] });
  });

  // finish_task missing summary
  assert.throws(() => {
    validateToolArgs(TOOL_NAMES.FINISH_TASK, { success: true });
  });
});

test('Schema Converters - Gemini & OpenAI Tool Declarations', () => {
  const geminiDecls = getGeminiToolDeclarations();
  assert.equal(geminiDecls.length, 19);
  assert.ok(geminiDecls[0].name);
  assert.ok(geminiDecls[0].parameters.type === 'OBJECT');

  const openAiDecls = getOpenAiToolDeclarations();
  assert.equal(openAiDecls.length, 19);
  assert.equal(openAiDecls[0].type, 'function');
  assert.ok(openAiDecls[0].function.name);
  assert.equal(openAiDecls[0].function.parameters.type, 'object');

  // Verify extract_structured nested array conversion in OpenAI declaration
  const extractSpec = openAiDecls.find(t => t.function.name === 'extract_structured');
  assert.ok(extractSpec);
  assert.equal(extractSpec.function.parameters.properties.fields.type, 'array');
  assert.equal(extractSpec.function.parameters.properties.fields.items.type, 'object');
  assert.ok(extractSpec.function.parameters.properties.fields.items.properties.name);
});

test('Tool Result & Error Contracts', () => {
  const page = { url: 'https://example.com/login', title: 'Example Login', id: 101 };
  
  // Success Result
  const successResult = createToolResult({
    toolName: 'read_page',
    observation: 'Page content here',
    page,
    metadata: { chars: 17 }
  });

  assert.equal(successResult.ok, true);
  assert.equal(successResult.toolName, 'read_page');
  assert.equal(successResult.observation, 'Page content here');
  assert.equal(successResult.page.url, 'https://example.com/login');
  assert.equal(successResult.page.id, 101);
  assert.equal(successResult.metadata.chars, 17);
  assert.equal(successResult.error, null);

  // Error Result
  const errorResult = createToolError({
    toolName: 'click_element',
    error: new Error('Element not found'),
    page,
    recoverable: true
  });

  assert.equal(errorResult.ok, false);
  assert.equal(errorResult.toolName, 'click_element');
  assert.ok(errorResult.observation.includes('ERROR [click_element]'));
  assert.equal(errorResult.error.message, 'Element not found');
  assert.equal(errorResult.error.recoverable, true);
});
