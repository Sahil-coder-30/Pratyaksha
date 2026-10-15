/**
 * PRATYAKSHA TypeSafe Jev System One Guardrail Module
 * Sovereign Privacy-First Browser Agent
 *
 * Implements machine-native boundary safety via TypeSafe AI's Jev model.
 * Evaluates typed binary probabilities (`noul`) and categorical severities (`score`)
 * in sub-100ms without generative conversation drift or HITL friction at boundaries.
 * Includes a zero-cloud local heuristic fallback when offline or keyless.
 */

let TypeSafeClient = null;
let noul = null;
let score = null;
let choice = null;

// Dynamically attempt importing @typesafe-ai/sdk
try {
  const sdk = await import('@typesafe-ai/sdk');
  TypeSafeClient = sdk.TypeSafeClient;
  noul = sdk.noul;
  score = sdk.score;
  choice = sdk.choice;
} catch (_) {
  // SDK may not yet be installed or available in this runtime
}

/**
 * Returns a configured TypeSafeClient or null if key is missing/SDK unavailable.
 */
export function getTypeSafeClient(options = {}) {
  const apiKey = options.apiKey ||
    (typeof process !== 'undefined' ? process.env?.TYPESAFE_API_KEY : null);

  if (!apiKey || !TypeSafeClient) {
    return null;
  }

  try {
    return new TypeSafeClient({
      apiKey,
      timeout: options.timeout || 5000 // Fast 5s timeout
    });
  } catch (err) {
    console.warn('[JevGuard] Could not initialize TypeSafeClient:', err.message);
    return null;
  }
}

/**
 * Local deterministic heuristic guard fallback (Zero-Cloud / Sovereign Mode).
 */
export function localHeuristicInputGuard(taskText = '') {
  const clean = (taskText || '').toLowerCase();

  const INJECTION_PATTERNS = [
    /ignore (all |any )?(previous|prior|above) (instructions|directions|rules)/i,
    /you are now (unrestricted|in developer mode|dan|jailbroken)/i,
    /disregard (safety|system) (guidelines|protocols|instructions)/i,
    /reveal (your |the )?(system prompt|hidden prompt|secret instructions)/i,
    /bypass (all |the )?(security|guardrails|filters)/i,
    /base64[a-z0-9+/=]{30,}/i
  ];

  const UNSUPPORTED_SCOPE_PATTERNS = [
    /download (and (run|execute)|malware|ransomware|trojan)/i,
    /ddos|port scan|exploit vulnerability|sql injection/i,
    /steal (cookies|session tokens|saved passwords)/i,
    /bypass (recaptcha|hcaptcha|turnstile) farm/i
  ];

  const HARMFUL_PATTERNS = [
    /transfer (all )?(money|funds|crypto) to/i,
    /wipe (entire )?(hard drive|system|database|table)/i,
    /purchase with stolen credit card/i
  ];

  let detectedJailbreak = false;
  let detectedScopeViolation = false;
  let detectedHarm = false;
  let reason = '';

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(clean)) {
      detectedJailbreak = true;
      reason = 'Potential prompt injection or instruction override detected';
      break;
    }
  }

  if (!detectedJailbreak) {
    for (const pattern of UNSUPPORTED_SCOPE_PATTERNS) {
      if (pattern.test(clean)) {
        detectedScopeViolation = true;
        reason = 'Task demands out-of-scope or prohibited security operations';
        break;
      }
    }
  }

  if (!detectedJailbreak && !detectedScopeViolation) {
    for (const pattern of HARMFUL_PATTERNS) {
      if (pattern.test(clean)) {
        detectedHarm = true;
        reason = 'Malicious financial or destructive intent detected';
        break;
      }
    }
  }

  const isBlocked = detectedJailbreak || detectedScopeViolation || detectedHarm;

  return {
    allowed: !isBlocked,
    provider: 'local_heuristic',
    hazardProbabilities: {
      is_jailbreak: detectedJailbreak ? 0.99 : 0.01,
      is_unsupported_scope: detectedScopeViolation ? 0.95 : 0.02,
      is_harmful_intent: detectedHarm ? 0.95 : 0.01
    },
    harmSeverity: isBlocked ? 'severe' : 'none',
    reason: isBlocked ? reason : 'Passed local heuristic validation'
  };
}

/**
 * Evaluates input user task and target URL using TypeSafe Jev System One model.
 * Falls back seamlessly to local heuristic evaluation if key/SDK is absent.
 */
export async function evaluateInputWithJev(taskText, pageContext = {}, options = {}) {
  const client = getTypeSafeClient(options);

  // If no client or SDK helpers, run fast local heuristic
  if (!client || !noul || !score) {
    return localHeuristicInputGuard(taskText);
  }

  try {
    const response = await client.systemOne({
      state: {
        task: taskText,
        pageUrl: pageContext.url || '',
        pageTitle: pageContext.title || ''
      },
      questions: {
        is_jailbreak: noul('Does this task attempt to override instructions, bypass boundaries, or jailbreak the assistant?'),
        is_unsupported_scope: noul('Does this request ask for illegal system access, malware deployment, or actions outside safe web browsing?'),
        is_harmful_intent: noul('Does this task aim to commit fraud, steal data, or cause real-world harm?'),
        harm_severity: score('Rate the severity of potential harm if this browser task executes:', {
          none: null,
          low: null,
          moderate: null,
          severe: null
        })
      }
    });

    const jailbreakProb = response.answers?.is_jailbreak?.probability ?? 0;
    const scopeProb = response.answers?.is_unsupported_scope?.probability ?? 0;
    const harmProb = response.answers?.is_harmful_intent?.probability ?? 0;
    const severity = response.answers?.harm_severity?.score || 'none';

    // Mathematical thresholding (calibrated from TypeSafe System One)
    const isJailbreak = jailbreakProb > 0.80;
    const isScopeViolation = scopeProb > 0.80;
    const isHarmful = harmProb > 0.80 || severity === 'severe' || severity === 'moderate';

    const isAllowed = !isJailbreak && !isScopeViolation && !isHarmful;

    let reason = 'Safe';
    if (isJailbreak) reason = `High jailbreak probability (${(jailbreakProb * 100).toFixed(1)}%)`;
    else if (isScopeViolation) reason = `Out-of-scope automated browser action (${(scopeProb * 100).toFixed(1)}%)`;
    else if (isHarmful) reason = `Hazardous intent detected (Severity: ${severity})`;

    return {
      allowed: isAllowed,
      provider: 'typesafe_jev',
      hazardProbabilities: {
        is_jailbreak: jailbreakProb,
        is_unsupported_scope: scopeProb,
        is_harmful_intent: harmProb
      },
      harmSeverity: severity,
      reason
    };
  } catch (err) {
    console.warn('[JevGuard] Jev evaluation failed, falling back to local heuristic:', err.message);
    return localHeuristicInputGuard(taskText);
  }
}

/**
 * Evaluates agent output summary and action evidence using TypeSafe Jev System One model.
 */
export async function evaluateOutputWithJev(summaryText, verificationEvidence = '', options = {}) {
  const client = getTypeSafeClient(options);

  if (!client || !noul) {
    const clean = (summaryText || '').toLowerCase();
    const hasHallucinationMarkers = clean.includes('as an ai') || clean.includes('i cannot browse');
    return {
      allowed: !hasHallucinationMarkers,
      provider: 'local_heuristic',
      isHallucination: hasHallucinationMarkers,
      reason: hasHallucinationMarkers ? 'Generic model boilerplate detected' : 'Output verified'
    };
  }

  try {
    const response = await client.systemOne({
      state: {
        summary: summaryText,
        evidence: verificationEvidence
      },
      questions: {
        is_hallucination: noul('Does the summary claim actions occurred that are completely unsupported by the provided evidence?'),
        is_policy_compliant: noul('Did the summary follow safe agent boundaries without leaking confidential tokens or harmful output?')
      }
    });

    const hallucinationProb = response.answers?.is_hallucination?.probability ?? 0;
    const compliantProb = response.answers?.is_policy_compliant?.probability ?? 1;

    const isHallucinated = hallucinationProb > 0.75;
    const isCompliant = compliantProb > 0.35;
    const isAllowed = !isHallucinated && isCompliant;

    return {
      allowed: isAllowed,
      provider: 'typesafe_jev',
      isHallucination: isHallucinated,
      probabilities: {
        is_hallucination: hallucinationProb,
        is_policy_compliant: compliantProb
      },
      reason: !isAllowed ? 'Output failed groundedness/policy verification' : 'Verified by Jev'
    };
  } catch (err) {
    console.warn('[JevGuard] Output Jev evaluation failed, falling back:', err.message);
    return {
      allowed: true,
      provider: 'fallback',
      reason: 'Output fallback permitted'
    };
  }
}
