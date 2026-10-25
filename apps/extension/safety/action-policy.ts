// BigFish Action Policy: detects risky operations that require human approval.
// Examples: clicking "Send", "Pay", "Delete", "Confirm", "Submit", or typing Enter in critical forms.

// "sign" alone means signing something; "Sign in / up / out" is not risky.
const RISKY_LABEL_REGEX =
  /\b(send|pay|buy|purchase|delete|remove|destroy|submit order|place order|checkout|transfer|grant|authorize|publish|sign(?!\s*(?:in|up|out)\b))\b/i;
const SEARCH_HINT_REGEX = /\b(search|find|query|filter|lookup)\b/i;

export interface ActionDescriptor {
  label?: string;
  role?: string;
  formSubmitLabel?: string;
  isSearch?: boolean;
  crossOrigins?: string[];
}

export function classifyAction(
  tool: string,
  args: any,
  descriptor: ActionDescriptor = {}
): { needsApproval: boolean; reason?: string } {
  // 1. Cross-origin PII rehydration requires explicit user consent
  if (descriptor.crossOrigins && descriptor.crossOrigins.length > 0) {
    return {
      needsApproval: true,
      reason: `Action sends private data from [${descriptor.crossOrigins.join(", ")}] to a different origin.`,
    };
  }

  // 2. Click actions
  if (tool === "browser_click") {
    const label = descriptor.label || "";
    if (RISKY_LABEL_REGEX.test(label)) {
      return {
        needsApproval: true,
        reason: `Clicking sensitive button "${label}".`,
      };
    }
  }

  // 3. Typing with submit: true or press_key Enter
  if (tool === "browser_type" && args?.submit) {
    if (!descriptor.isSearch && descriptor.formSubmitLabel && RISKY_LABEL_REGEX.test(descriptor.formSubmitLabel)) {
      return {
        needsApproval: true,
        reason: `Submitting form with sensitive button "${descriptor.formSubmitLabel}".`,
      };
    }
  }

  if (tool === "browser_press_key" && args?.key?.toLowerCase() === "enter") {
    if (!descriptor.isSearch && descriptor.formSubmitLabel && RISKY_LABEL_REGEX.test(descriptor.formSubmitLabel)) {
      return {
        needsApproval: true,
        reason: `Pressing Enter submits form with sensitive button "${descriptor.formSubmitLabel}".`,
      };
    }
  }

  // 4. Fill form with submit_ref
  if (tool === "browser_fill_form" && args?.submit_ref) {
    const label = descriptor.formSubmitLabel || descriptor.label || "";
    if (RISKY_LABEL_REGEX.test(label)) {
      return {
        needsApproval: true,
        reason: `Submitting form via button "${label}".`,
      };
    }
  }

  return { needsApproval: false };
}
