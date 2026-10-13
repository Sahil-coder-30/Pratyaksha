/**
 * PRATYAKSHA (प्रत्यक्ष) Hybrid Agent Planner
 * Sovereign, Privacy-First Browser Agent Planner
 * 
 * Provides:
 *  1. Zero-Config Deterministic Semantic Action Planner (100% Offline)
 *  2. Optional Google Gemini 2.0/1.5 Flash Cloud Integration
 */

export class AgentPlanner {
  /**
   * Generates a structured sequence of browser actions from a prompt and page context
   * @param {string} rawPrompt 
   * @param {string} sanitizedPrompt (with PII masked as tokens)
   * @param {Object} pageContext ({ url, title, elements: [] })
   * @param {Object} options ({ useGemini: boolean, apiKey: string, model: string })
   * @returns {Promise<{ plan: Array<Object>, source: 'DETERMINISTIC' | 'GEMINI' }>}
   */
  static async generatePlan(rawPrompt, sanitizedPrompt, pageContext, options = {}) {
    const prompt = (sanitizedPrompt || rawPrompt || '').trim();

    // 1. If user opted for Gemini API and key is present, attempt cloud reasoning
    if (options.useGemini && options.apiKey) {
      try {
        const geminiPlan = await this.planWithGemini(prompt, pageContext, options);
        if (geminiPlan && geminiPlan.length > 0) {
          return { plan: geminiPlan, source: 'GEMINI' };
        }
      } catch (err) {
        console.warn('[PRATYAKSHA Planner] Gemini planning failed, falling back to deterministic planner:', err);
        const fallbackPlan = this.planDeterministic(prompt, pageContext);
        return { plan: fallbackPlan, source: 'DETERMINISTIC', error: err.message };
      }
    }

    // 2. Default: High-Precision Deterministic Semantic Action Planner
    const deterministicPlan = this.planDeterministic(prompt, pageContext);
    return { plan: deterministicPlan, source: 'DETERMINISTIC' };
  }

  /**
   * Deterministic Semantic Planner (Works completely offline with 0 dependencies)
   * @param {string} prompt 
   * @param {Object} context 
   * @returns {Array<Object>}
   */
  static planDeterministic(prompt, context) {
    const p = prompt.toLowerCase();
    const elements = context.elements || [];
    const plan = [];

    // ── CASE 1: CLICK / OPEN / SELECT INTENT (Check first for explicit button clicks) ──
    const clickMatch = prompt.match(/^(?:click|press|open|select|hit|tap)\s*(?:on)?\s*(?:the)?\s*["']?([^"']+)["']?/i);
    if (clickMatch) {
      const targetPhrase = clickMatch[1].trim().toLowerCase();

      // Score elements by text match
      let bestEl = null;
      let highestScore = 0;

      for (const el of elements) {
        let score = 0;
        const text = (el.text || '').toLowerCase();
        const aria = (el.ariaLabel || '').toLowerCase();
        const title = (el.title || '').toLowerCase();
        const val = (el.value || '').toLowerCase();
        const placeholder = (el.placeholder || '').toLowerCase();

        if (text === targetPhrase || aria === targetPhrase || val === targetPhrase) score += 100;
        else if (text.includes(targetPhrase) || aria.includes(targetPhrase)) score += 50;
        else if (title.includes(targetPhrase) || placeholder.includes(targetPhrase)) score += 30;

        // Bias towards clickable elements
        if (el.tag === 'button' || el.tag === 'a' || el.role === 'button' || el.type === 'submit') {
          score += 15;
        }

        if (score > highestScore) {
          highestScore = score;
          bestEl = el;
        }
      }

      if (bestEl) {
        plan.push({
          step: 1,
          action: 'SCROLL_INTO_VIEW',
          selector: bestEl.selector,
          description: `Scroll to target: "${bestEl.text || bestEl.ariaLabel || bestEl.selector}"`
        });
        plan.push({
          step: 2,
          action: 'HIGHLIGHT',
          selector: bestEl.selector,
          description: `Highlight element [${bestEl.tag.toUpperCase()}]`
        });
        plan.push({
          step: 3,
          action: 'CLICK',
          selector: bestEl.selector,
          description: `Click "${bestEl.text || bestEl.ariaLabel || bestEl.selector}"`
        });
        return plan;
      }
    }

    // ── CASE 2: SEARCH INTENT ──
    const searchMatch = prompt.match(/^(?:search\s*(?:for|about)?|look\s*up|find|query)\s+["']?([^"']+)["']?/i) ||
                        prompt.match(/(?:search\s+(?:for|about))\s+["']?([^"']+)["']?/i);
    if (searchMatch || p.startsWith('search ')) {
      const query = searchMatch ? searchMatch[1].trim() : prompt.replace(/^search\s+/i, '').trim();

      // Find the best search input field
      const searchInput = elements.find(el => 
        el.tag === 'input' && (
          el.type === 'search' ||
          /search|query|find|txtsearch|searchbar/i.test(el.name || '') ||
          /search|query|find/i.test(el.id || '') ||
          /search|find|query/i.test(el.placeholder || '') ||
          /search/i.test(el.ariaLabel || '')
        )
      ) || elements.find(el => el.tag === 'input' && (el.type === 'text' || !el.type));

      if (searchInput) {
        plan.push({
          step: 1,
          action: 'HIGHLIGHT',
          selector: searchInput.selector,
          description: `Locate search input field "${searchInput.placeholder || searchInput.name || searchInput.selector}"`
        });
        plan.push({
          step: 2,
          action: 'TYPE',
          selector: searchInput.selector,
          value: query,
          description: `Type search query: "${query}"`
        });
        plan.push({
          step: 3,
          action: 'PRESS_ENTER',
          selector: searchInput.selector,
          description: 'Submit search by pressing Enter'
        });
        return plan;
      }
    }

    // ── CASE 3: SCROLL INTENT ──
    if (p.includes('scroll down') || p.includes('scroll to bottom') || p.includes('page down')) {
      const amount = p.includes('bottom') ? 3000 : 700;
      plan.push({
        step: 1,
        action: 'SCROLL',
        deltaY: amount,
        description: `Smooth scroll down page by ${amount}px`
      });
      return plan;
    }
    if (p.includes('scroll up') || p.includes('scroll to top') || p.includes('page up')) {
      const amount = p.includes('top') ? -3000 : -700;
      plan.push({
        step: 1,
        action: 'SCROLL',
        deltaY: amount,
        description: `Smooth scroll up page by ${Math.abs(amount)}px`
      });
      return plan;
    }

    // ── CASE 4: FORM FILL INTENT ──
    if (p.includes('fill') || p.includes('enter') || p.includes('type')) {
      // Look for multiple key-value pairs or tokens
      const inputFields = elements.filter(el => el.tag === 'input' || el.tag === 'textarea');
      let stepCounter = 1;

      // Check for Email
      const emailTokenMatch = prompt.match(/\[EMAIL_[A-F0-9]+\]/i) || prompt.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
      if (emailTokenMatch) {
        const emailInput = inputFields.find(el => el.type === 'email' || /email|mail/i.test(el.name || el.id || el.placeholder || ''));
        if (emailInput) {
          plan.push({
            step: stepCounter++,
            action: 'HIGHLIGHT',
            selector: emailInput.selector,
            description: `Target email field (${emailInput.name || emailInput.selector})`
          });
          plan.push({
            step: stepCounter++,
            action: 'TYPE',
            selector: emailInput.selector,
            value: emailTokenMatch[0],
            description: `Type email value into field`
          });
        }
      }

      // Check for Phone
      const phoneTokenMatch = prompt.match(/\[PHONE_[A-F0-9]+\]/i) || prompt.match(/(?:\+91|0)?[6-9]\d{9}/);
      if (phoneTokenMatch) {
        const phoneInput = inputFields.find(el => el.type === 'tel' || /phone|mobile|contact/i.test(el.name || el.id || el.placeholder || ''));
        if (phoneInput) {
          plan.push({
            step: stepCounter++,
            action: 'HIGHLIGHT',
            selector: phoneInput.selector,
            description: `Target phone/mobile field (${phoneInput.name || phoneInput.selector})`
          });
          plan.push({
            step: stepCounter++,
            action: 'TYPE',
            selector: phoneInput.selector,
            value: phoneTokenMatch[0],
            description: `Type mobile number into field`
          });
        }
      }

      // Check for Aadhaar
      const aadhaarTokenMatch = prompt.match(/\[AADHAAR_[A-F0-9]+\]/i);
      if (aadhaarTokenMatch) {
        const aadhaarInput = inputFields.find(el => /aadhaar|uid|id/i.test(el.name || el.id || el.placeholder || ''));
        if (aadhaarInput) {
          plan.push({
            step: stepCounter++,
            action: 'HIGHLIGHT',
            selector: aadhaarInput.selector,
            description: `Target Aadhaar UID field`
          });
          plan.push({
            step: stepCounter++,
            action: 'TYPE',
            selector: aadhaarInput.selector,
            value: aadhaarTokenMatch[0],
            description: `Rehydrate & type verified Aadhaar into field`
          });
        }
      }

      if (plan.length > 0) return plan;
    }

    // ── CASE 5: FALLBACK SEMANTIC MATCH ──
    // If no explicit intent matched, inspect page for best matching button or heading
    const candidate = elements.find(el => 
      (el.tag === 'button' || el.tag === 'a' || el.tag === 'input') &&
      prompt.toLowerCase().split(/\s+/).some(word => word.length > 3 && (el.text || '').toLowerCase().includes(word))
    );

    if (candidate) {
      plan.push({
        step: 1,
        action: 'SCROLL_INTO_VIEW',
        selector: candidate.selector,
        description: `Scroll to matched element "${candidate.text || candidate.selector}"`
      });
      plan.push({
        step: 2,
        action: 'HIGHLIGHT',
        selector: candidate.selector,
        description: `Highlight [${candidate.tag.toUpperCase()}] "${candidate.text || candidate.selector}"`
      });
      plan.push({
        step: 3,
        action: candidate.tag === 'input' ? 'FOCUS' : 'CLICK',
        selector: candidate.selector,
        description: `Interact with "${candidate.text || candidate.selector}"`
      });
      return plan;
    }

    // Default general scroll if nothing else found
    plan.push({
      step: 1,
      action: 'SCROLL',
      deltaY: 500,
      description: 'Explore page content (scroll 500px)'
    });
    return plan;
  }

  /**
   * Google Gemini VLM Planning Integration
   * @param {string} prompt 
   * @param {Object} context 
   * @param {Object} options 
   * @returns {Promise<Array<Object>>}
   */
  static async planWithGemini(prompt, context, options) {
    const apiKey = (options.apiKey || '').trim();
    if (!apiKey) throw new Error('API key is empty');
    let model = options.model || 'gemini-3.5-flash';
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    // Compact element catalog (top 35 interactive elements)
    const elementsSample = (context.elements || []).slice(0, 35).map(el => ({
      tag: el.tag,
      type: el.type,
      text: (el.text || '').slice(0, 60),
      aria: el.ariaLabel || '',
      placeholder: el.placeholder || '',
      selector: el.selector
    }));

    const systemInstruction = `You are PRATYAKSHA (प्रत्यक्ष), a sovereign, light-weight privacy-first browser automation agent.
Given a user prompt and active webpage DOM elements, produce a JSON array of sequential browser actions to accomplish the goal.
Available actions:
- "CLICK": clicks an element (requires "selector")
- "TYPE": types text into an input (requires "selector" and "value")
- "PRESS_ENTER": presses enter on an element (requires "selector")
- "SCROLL": scrolls viewport (requires "deltaY": number, e.g. 600 or -600)
- "WAIT": pauses execution (requires "durationMs": number, e.g. 500)

Return ONLY a raw JSON array matching this schema:
[
  { "step": 1, "action": "CLICK", "selector": "css_selector", "value": "optional", "description": "concise rationale" }
]
Do not wrap in markdown quotes if possible.`;

    const requestBody = {
      contents: [{
        parts: [
          { text: systemInstruction },
          { text: `Page URL: ${context.url}\nPage Title: ${context.title}\nInteractive Elements: ${JSON.stringify(elementsSample)}\nUser Request: ${prompt}` }
        ]
      }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1
      }
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      let errorMsg = `HTTP ${response.status}`;
      try {
        const errJson = await response.json();
        if (errJson?.error?.message) {
          errorMsg = errJson.error.message;
        }
      } catch (e) {
        const errText = await response.text().catch(() => '');
        if (errText) errorMsg += `: ${errText.slice(0, 150)}`;
      }
      throw new Error(`Gemini API error: ${errorMsg}`);
    }

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) throw new Error('Empty response from Gemini API');

    let cleanJson = rawText.trim();
    const codeBlockMatch = cleanJson.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
      cleanJson = codeBlockMatch[1].trim();
    } else {
      const firstBracket = cleanJson.indexOf('[');
      const lastBracket = cleanJson.lastIndexOf(']');
      if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
        cleanJson = cleanJson.substring(firstBracket, lastBracket + 1);
      }
    }

    const parsedPlan = JSON.parse(cleanJson);
    const result = Array.isArray(parsedPlan) ? parsedPlan : (parsedPlan.plan || parsedPlan.steps || parsedPlan.actions || []);
    return result;
  }
}
