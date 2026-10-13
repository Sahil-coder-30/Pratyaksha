/**
 * PRATYAKSHA Test Suite: LangChain Model Factory
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeModel,
  makeModelWithFallbacks,
  validateModelConfig,
  normalizeModelName,
  SUPPORTED_PROVIDERS
} from '../src/agent/models.js';
import { ChatMistralAI } from '@langchain/mistralai';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatOpenAI } from '@langchain/openai';
import { diagnoseExecutionError } from '../src/runner.js';

test('Model Config Validation - Invalid Configurations Fail Early', () => {
  // Missing provider
  assert.throws(() => {
    validateModelConfig({});
  }, { code: 'INVALID_PROVIDER' });

  // Unsupported provider
  assert.throws(() => {
    validateModelConfig({ provider: 'unsupported-llm', apiKey: 'xyz' });
  }, { code: 'INVALID_PROVIDER' });

  // Missing API key
  assert.throws(() => {
    validateModelConfig({ provider: 'mistral', apiKey: '' });
  }, { code: 'MISSING_API_KEY' });
});

test('Model Normalization - Legacy & Default Mappings', () => {
  assert.equal(normalizeModelName('gemini', 'gemini-2.0-flash'), 'gemini-3.5-flash');
  assert.equal(normalizeModelName('gemini', ''), 'gemini-3.5-flash');
  assert.equal(normalizeModelName('mistral', ''), 'ministral-8b-latest');
  assert.equal(normalizeModelName('mistral', 'mistral-large-latest'), 'ministral-8b-latest');
  assert.equal(normalizeModelName('openrouter', ''), 'deepseek/deepseek-v4.1-flash');
  assert.equal(normalizeModelName('openrouter', 'deepseek-v4.1-flash'), 'deepseek/deepseek-v4.1-flash');
  assert.equal(normalizeModelName('openrouter', 'deepseek/deepseek-chat'), 'deepseek/deepseek-chat');
  assert.equal(normalizeModelName('openrouter', 'deepseek/deepseek-chat:free'), 'deepseek/deepseek-chat:free');
});

test('Model Factory - Instantiates Valid ChatModels', () => {
  // Mistral (ministral-8b-latest)
  const mistral = makeModel({
    provider: 'mistral',
    apiKey: 'mock-mistral-key',
    model: 'ministral-8b-latest'
  });
  assert.ok(mistral instanceof ChatMistralAI);
  assert.equal(mistral.model, 'ministral-8b-latest');

  // Google Gemini (gemini-3.5-flash)
  const gemini = makeModel({
    provider: 'gemini',
    apiKey: 'mock-gemini-key',
    model: 'gemini-3.5-flash'
  });
  assert.ok(gemini instanceof ChatGoogleGenerativeAI);
  assert.equal(gemini.model, 'gemini-3.5-flash');

  // OpenRouter (DeepSeek V4.1 Flash)
  const openrouter = makeModel({
    provider: 'openrouter',
    apiKey: 'mock-openrouter-key',
    model: 'deepseek/deepseek-v4.1-flash'
  });
  assert.ok(openrouter instanceof ChatOpenAI);
  assert.equal(openrouter.model, 'deepseek/deepseek-v4.1-flash');
});

test('Model Factory - Fallback Chaining', () => {
  const modelWithFb = makeModelWithFallbacks(
    { provider: 'mistral', apiKey: 'key1', model: 'mistral-large-latest' },
    [
      { provider: 'mistral', apiKey: 'key1', model: 'codestral-latest' },
      { provider: 'gemini', apiKey: 'key2', model: 'gemini-3.8-flash' }
    ]
  );

  assert.ok(modelWithFb);
  // Verify withFallbacks wrapped the model
  assert.ok(typeof modelWithFb.invoke === 'function');
});

test('Model Factory - OpenRouter Sets maxTokens to Prevent 402 Credit Exhaustion', () => {
  const openrouter = makeModel({
    provider: 'openrouter',
    apiKey: 'mock-openrouter-key',
    model: 'deepseek/deepseek-chat'
  });
  assert.ok(openrouter instanceof ChatOpenAI);
  assert.equal(openrouter.maxTokens, 4096);
});

test('Diagnostic Error Formatter - Clarifies OpenRouter 402 and Network Disconnect', () => {
  // Test OpenRouter 402
  const error402 = new Error('This request requires more credits, or fewer max_tokens.');
  error402.status = 402;
  const diag402 = diagnoseExecutionError(error402, error402.message, '402');
  assert.equal(diag402.code, 'PAYMENT_REQUIRED');
  assert.ok(diag402.message.includes('402 Payment Required'));
  assert.ok(diag402.message.includes('openrouter.ai'));

  // Test Network Disconnection
  const netErr = new Error('Failed to load resource: net::ERR_INTERNET_DISCONNECTED');
  const diagNet = diagnoseExecutionError(netErr, netErr.message, 'NETWORK_ERROR');
  assert.equal(diagNet.code, 'NETWORK_DISCONNECTED');
  assert.ok(diagNet.message.includes('net::ERR_INTERNET_DISCONNECTED'));

  // Test Network Changed
  const changeErr = new Error('Failed to load resource: net::ERR_NETWORK_CHANGED');
  const diagChange = diagnoseExecutionError(changeErr, changeErr.message, 'NETWORK_ERROR');
  assert.equal(diagChange.code, 'NETWORK_DISCONNECTED');
  assert.ok(diagChange.message.includes('net::ERR_NETWORK_CHANGED'));
});
