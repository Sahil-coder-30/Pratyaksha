// BigFish agent: personal details guard. Models fill a "Full name" or "Phone"
// field with made-up values ("John Doe", "555-123-4567") even when told not to.
// Before a type or fill_form reaches the browser, every value for a personal
// field must appear somewhere the user or the page gave it: the user task or
// an earlier browser result in this run. Saved facts do not count: the model
// writes those itself. Otherwise the call is refused.
import { ErrorCode, toolError } from "@bigfish/contracts";

// Field labels that ask for the user's own details. "name of the hackathon" is not one.
const PERSONAL_LABEL =
  /\b(your name|full name|first name|last name|surname|name\b(?!\s+of)|e-?mail|phone|mobile|whatsapp|contact number|address|pin ?code|zip|date of birth|dob|birthday|age|roll (no|number)|enrol?ment|student id|employee id|aadhaa?r|pan\b|passport)/i;
// The user allowed made-up values ("fill it with dummy data", "use a fake email").
// Voice input can give Devanagari, where \b does not work, so that part has no \b.
const MADE_UP_ALLOWED =
  /\b(random|fake|dummy|sample|mock|placeholder|fictional|fictitious|made[- ]up|make (it |them |something |one )?up|invent|test (data|details|values|info|user|account|name|email|phone)|any (name|email|phone|details|values?|data)|kuch bhi)\b|डमी|फेक|नकली|कुछ भी/i;
// Lines like `2:14 textbox "Full name *" ="" in "Contact"`.
const ELEMENT_LINE = /^\*?(\d+:\d+) (\w+) "([^"]*)"(?:.*? in "([^"]*)")?/;

export interface GuardContext {
  task: string;
  // Text of the browser results seen in this run, oldest first.
  results: string[];
}

// True when the user asked for made-up values. Then nothing is refused, and the
// actor and the judge are told so too, for any task, not only forms.
export function allowsMadeUpValues(task: string): boolean {
  return MADE_UP_ALLOWED.test(task);
}

// Returns an ERROR line when a personal field gets a value nobody gave, else null.
export function checkPersonalValues(tool: string, args: Record<string, unknown>, ctx: GuardContext): string | null {
  const fields = fieldsOf(tool, args);
  if (fields.length === 0 || allowsMadeUpValues(ctx.task)) return null;
  const labels = labelsByRef(ctx.results);
  const given = [ctx.task, ...ctx.results].join("\n");
  const missing = fields
    .map(({ ref, value }) => ({ ref, value, label: labels.get(ref) }))
    .filter(({ label, value }) => label && PERSONAL_LABEL.test(label) && !appearsIn(value, given))
    .map(({ ref, label, value }) => `${ref} "${label}" = "${value}"`);
  if (missing.length === 0) return null;
  return toolError(
    ErrorCode.POLICY_BLOCKED,
    `These personal details were not given by the user: ${missing.join("; ")}.`,
    "Never make them up. Fill the other fields, and call fail_subtask naming the fields the user must give.",
  );
}

function fieldsOf(tool: string, args: Record<string, unknown>): { ref: string; value: string }[] {
  if (tool === "browser_type") return [{ ref: String(args.ref), value: String(args.text ?? "") }];
  if (tool === "browser_fill_form" && Array.isArray(args.fields)) {
    return (args.fields as { ref: string; value: string }[])
      .map((f) => ({ ref: String(f.ref), value: String(f.value ?? "") }))
      // Radios and checkboxes get true/false, not a value.
      .filter((f) => !/^(true|false|yes|no|on|off|checked|unchecked)$/i.test(f.value.trim()));
  }
  return [];
}

// The newest line for each ref wins: its name, plus the question it belongs to.
function labelsByRef(results: string[]): Map<string, string> {
  const labels = new Map<string, string>();
  for (const text of results) {
    for (const line of text.split(/\n|, (?=\*?\d+:\d+ )/)) {
      const m = ELEMENT_LINE.exec(line.trim().replace(/^.*?(changed|new): /, ""));
      if (m) labels.set(m[1]!, [m[3], m[4]].filter(Boolean).join(" in "));
    }
  }
  return labels;
}

function appearsIn(value: string, text: string): boolean {
  const v = value.trim().toLowerCase().replace(/\s+/g, " ");
  if (!v) return true;
  if (text.toLowerCase().replace(/\s+/g, " ").includes(v)) return true;
  // Phone numbers are written many ways: compare each number in the text by its digits.
  const digits = v.replace(/\D/g, "");
  if (digits.length < 6) return false;
  return (text.match(/\+?\d[\d\s().-]{4,}\d/g) ?? []).some((n) => n.replace(/\D/g, "").endsWith(digits) || digits.endsWith(n.replace(/\D/g, "")));
}
