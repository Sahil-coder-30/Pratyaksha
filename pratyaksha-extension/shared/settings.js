/**
 * PRATYAKSHA User Settings (Bring Your Own Key)
 *
 * The extension ships with no API keys. Each user pastes their own key in the
 * side panel settings, and it is stored only in chrome.storage.local on their
 * device. Keys are sent only to the provider the user selected.
 */

export const DEFAULT_SETTINGS = {
  provider: 'mistral',
  privacyMode: 'strict',
  tinyfishApiKey: '',
  mistralApiKey: '',
  mistralModel: 'codestral-latest',
  geminiApiKey: '',
  geminiModel: 'gemini-3.5-flash',
  openrouterApiKey: '',
  openrouterModel: 'deepseek/deepseek-v4.1-flash'
};

export const PROVIDER_LABELS = {
  tinyfish: 'TinyFish',
  mistral: 'Mistral',
  openrouter: 'OpenRouter',
  gemini: 'Gemini',
  deterministic: 'Deterministic'
};

const API_KEY_FIELDS = {
  tinyfish: 'tinyfishApiKey',
  mistral: 'mistralApiKey',
  openrouter: 'openrouterApiKey',
  gemini: 'geminiApiKey'
};

const MODEL_FIELDS = {
  mistral: 'mistralModel',
  openrouter: 'openrouterModel',
  gemini: 'geminiModel'
};

/** Reads all settings, filling anything the user has not saved with defaults. */
export async function readSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  return { ...DEFAULT_SETTINGS, ...stored };
}

/** Persists a partial settings object. */
export async function writeSettings(patch) {
  await chrome.storage.local.set(patch);
}

/** True when the provider cannot run without a user supplied API key. */
export function providerNeedsKey(provider) {
  return provider in API_KEY_FIELDS;
}

/** Returns the API key and model for the given (or currently selected) provider. */
export function getProviderCredentials(settings, provider = settings.provider) {
  return {
    apiKey: (settings[API_KEY_FIELDS[provider]] || '').trim(),
    model: settings[MODEL_FIELDS[provider]] || undefined
  };
}
