/**
 * PRATYAKSHA LangChain Model Factory
 * Sovereign Privacy-First Browser Agent
 *
 * Provides validated model instantiation for:
 * - Mistral AI (ChatMistralAI)
 * - Google Gemini (ChatGoogleGenerativeAI)
 * - OpenRouter (ChatOpenAI with openrouter baseURL)
 * Includes deterministic fallback chaining and strict credential validation.
 */

import { ChatMistralAI } from '@langchain/mistralai';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatOpenAI } from '@langchain/openai';
import { PratyakshaError, ValidationError, UnauthorizedError, coerceToAppError } from '../shared/errors.js';

export const SUPPORTED_PROVIDERS = Object.freeze({
  MISTRAL: 'mistral',
  GEMINI: 'gemini',
  OPENROUTER: 'openrouter'
});

export const DEFAULT_MODELS = Object.freeze({
  [SUPPORTED_PROVIDERS.MISTRAL]: 'codestral-latest',
  [SUPPORTED_PROVIDERS.GEMINI]: 'gemini-3.5-flash',
  [SUPPORTED_PROVIDERS.OPENROUTER]: 'deepseek/deepseek-v4.1-flash'
});

/**
 * Normalizes provider model IDs to the single verified working production model per company.
 */
export function normalizeModelName(provider, model) {
  const p = (provider || '').toLowerCase();
  let m = (model || '').trim();

  if (!m) {
    return DEFAULT_MODELS[p] || 'codestral-latest';
  }

  if (p === SUPPORTED_PROVIDERS.MISTRAL) {
    if (!m || m === 'mistral-large-latest') return 'codestral-latest';
    return m;
  }

  if (p === SUPPORTED_PROVIDERS.GEMINI) {
    return 'gemini-3.5-flash';
  }

  if (p === SUPPORTED_PROVIDERS.OPENROUTER) {
    if (!m) return DEFAULT_MODELS[p] || 'deepseek/deepseek-v4.1-flash';
    if (m === 'deepseek-v4.1-flash') return 'deepseek/deepseek-v4.1-flash';
    return m;
  }

  return m;
}

/**
 * Validates model configuration before instantiation.
 */
export function validateModelConfig(config = {}) {
  const provider = (config.provider || '').toLowerCase();
  if (!Object.values(SUPPORTED_PROVIDERS).includes(provider)) {
    throw new PratyakshaError(
      `Unsupported provider: "${config.provider}". Supported providers: ${Object.values(SUPPORTED_PROVIDERS).join(', ')}`,
      { code: 'INVALID_PROVIDER', statusCode: 400, recoverable: false, details: { provider: config.provider } }
    );
  }

  const apiKey = (config.apiKey || '').trim();
  if (!apiKey) {
    throw new PratyakshaError(
      `API key is required for provider "${provider}". Configure your API key in Settings.`,
      { code: 'MISSING_API_KEY', statusCode: 401, recoverable: false, details: { provider } }
    );
  }

  return {
    provider,
    model: normalizeModelName(provider, config.model),
    apiKey,
    temperature: typeof config.temperature === 'number' ? config.temperature : 0.1,
    maxRetries: typeof config.maxRetries === 'number' ? config.maxRetries : 2,
    maxTokens: typeof config.maxTokens === 'number' ? config.maxTokens : (provider === SUPPORTED_PROVIDERS.OPENROUTER ? 4096 : undefined)
  };
}

/**
 * Factory creating a validated LangChain ChatModel instance.
 */
export function makeModel(config = {}) {
  const valid = validateModelConfig(config);

  try {
    switch (valid.provider) {
      case SUPPORTED_PROVIDERS.MISTRAL:
        return new ChatMistralAI({
          apiKey: valid.apiKey,
          model: valid.model,
          temperature: valid.temperature,
          maxRetries: Math.max(3, valid.maxRetries)
        });

      case SUPPORTED_PROVIDERS.GEMINI:
        return new ChatGoogleGenerativeAI({
          apiKey: valid.apiKey,
          model: valid.model,
          temperature: valid.temperature,
          maxRetries: valid.maxRetries
        });

      case SUPPORTED_PROVIDERS.OPENROUTER:
        return new ChatOpenAI({
          apiKey: valid.apiKey,
          model: valid.model,
          temperature: valid.temperature,
          maxRetries: Math.max(3, valid.maxRetries),
          // CRITICAL: OpenRouter requires an upfront credit reservation equal to maxTokens * price.
          // By default, ChatOpenAI requests up to 131,072 tokens which triggers HTTP 402 Payment Required
          // if key credits < ~$0.15. Setting maxTokens to 4096 keeps reservation down to ~$0.002.
          maxTokens: valid.maxTokens || 4096,
          configuration: {
            baseURL: 'https://openrouter.ai/api/v1',
            defaultHeaders: {
              'HTTP-Referer': 'https://pratyaksha.ai',
              'X-Title': 'PRATYAKSHA Sovereign Browser Agent'
            }
          }
        });

      default:
        throw new PratyakshaError(`Unhandled provider: ${valid.provider}`, { code: 'INVALID_PROVIDER', statusCode: 400 });
    }
  } catch (err) {
    throw coerceToAppError(err);
  }
}

/**
 * Creates a primary model configured with an ordered chain of fallbacks.
 */
export function makeModelWithFallbacks(primaryConfig, fallbackConfigs = []) {
  const primaryModel = makeModel(primaryConfig);
  if (!Array.isArray(fallbackConfigs) || fallbackConfigs.length === 0) {
    return primaryModel;
  }

  const fallbackModels = [];
  for (const fbConfig of fallbackConfigs) {
    try {
      const fbModel = makeModel(fbConfig);
      fallbackModels.push(fbModel);
    } catch (err) {
      console.warn(`[PRATYAKSHA Models] Skipping invalid fallback configuration: ${err.message}`);
    }
  }

  if (fallbackModels.length === 0) {
    return primaryModel;
  }

  const underlyingRunnable = primaryModel.withFallbacks(fallbackModels);

  return {
    primaryModel,
    fallbackModels,
    runnable: underlyingRunnable,

    bindTools(tools, options) {
      const boundPrimary = primaryModel.bindTools(tools, options);
      const boundFallbacks = fallbackModels.map(fb => fb.bindTools(tools, options));
      return boundPrimary.withFallbacks(boundFallbacks);
    },

    withStructuredOutput(schema, options) {
      if (typeof primaryModel.withStructuredOutput === 'function') {
        const boundPrimary = primaryModel.withStructuredOutput(schema, options);
        const boundFallbacks = fallbackModels
          .filter(fb => typeof fb.withStructuredOutput === 'function')
          .map(fb => fb.withStructuredOutput(schema, options));
        return boundFallbacks.length > 0
          ? boundPrimary.withFallbacks(boundFallbacks)
          : boundPrimary;
      }
      return underlyingRunnable;
    },

    async invoke(input, options) {
      return underlyingRunnable.invoke(input, options);
    },

    async batch(inputs, options) {
      return underlyingRunnable.batch(inputs, options);
    },

    async stream(input, options) {
      return underlyingRunnable.stream(input, options);
    }
  };
}

/**
 * Builds intelligent fallback configurations to withstand 429 rate limits,
 * capacity exhaustion (e.g. Mistral 3505 backend_out_of_capacity), and downtime.
 */
export function buildAutomaticFallbacks(primaryConfig = {}, options = {}) {
  const fallbacks = [];
  const provider = (primaryConfig.provider || '').toLowerCase();
  const currentModel = normalizeModelName(provider, primaryConfig.model);

  if (provider === SUPPORTED_PROVIDERS.MISTRAL && primaryConfig.apiKey) {
    // 1. Intra-provider degradation for Mistral capacity limits
    const mistralFallbacks = ['open-mistral-nemo', 'codestral-latest', 'ministral-8b-latest'];
    for (const cand of mistralFallbacks) {
      if (cand !== currentModel) {
        fallbacks.push({
          provider: SUPPORTED_PROVIDERS.MISTRAL,
          apiKey: primaryConfig.apiKey,
          model: cand,
          temperature: primaryConfig.temperature
        });
      }
    }
  } else if (provider === SUPPORTED_PROVIDERS.OPENROUTER && primaryConfig.apiKey) {
    // 1. Intra-provider degradation for OpenRouter
    const orFallbacks = ['deepseek/deepseek-chat', 'deepseek/deepseek-chat:free', 'deepseek/deepseek-v4.1-flash'];
    for (const cand of orFallbacks) {
      if (cand !== currentModel) {
        fallbacks.push({
          provider: SUPPORTED_PROVIDERS.OPENROUTER,
          apiKey: primaryConfig.apiKey,
          model: cand,
          maxTokens: 4096,
          temperature: primaryConfig.temperature
        });
      }
    }
  }

  // 2. Cross-provider fallback to Google Gemini if available
  if (options.geminiApiKey && provider !== SUPPORTED_PROVIDERS.GEMINI) {
    fallbacks.push({
      provider: SUPPORTED_PROVIDERS.GEMINI,
      apiKey: options.geminiApiKey,
      model: 'gemini-3.5-flash',
      temperature: primaryConfig.temperature
    });
  }

  // 3. Cross-provider fallback to OpenRouter if available
  if (options.openrouterApiKey && provider !== SUPPORTED_PROVIDERS.OPENROUTER) {
    fallbacks.push({
      provider: SUPPORTED_PROVIDERS.OPENROUTER,
      apiKey: options.openrouterApiKey,
      model: 'deepseek/deepseek-chat',
      maxTokens: 4096,
      temperature: primaryConfig.temperature
    });
  }

  // 4. Cross-provider fallback to Mistral if available
  if (options.mistralApiKey && provider !== SUPPORTED_PROVIDERS.MISTRAL) {
    fallbacks.push({
      provider: SUPPORTED_PROVIDERS.MISTRAL,
      apiKey: options.mistralApiKey,
      model: 'open-mistral-nemo',
      temperature: primaryConfig.temperature
    });
  }

  return fallbacks;
}
