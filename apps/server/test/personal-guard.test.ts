// Personal details guard: made-up names and phones never reach the browser.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { allowsMadeUpValues, checkPersonalValues } from "../src/agent/personal-guard.js";

const SNAPSHOT = [
  "[tab 2] Hackathon Feedback | 127.0.0.1/gform.html | scroll 0/2286",
  '2:14 textbox "Full name *" =""',
  '2:15 radio "AI Agents" [ ] in "Which track did you join? *"',
  '2:21 textbox "What is the capital of France? *" =""',
  '2:22 textbox "Your answer" ="" in "What\'s the name of IIIT-D hackathon ? *"',
  '2:23 textbox "Phone number (optional)" =""',
  '2:24 textbox "Your answer" ="" in "What\'s your name ?"',
].join("\n");

const fill = (...fields: [string, string][]) => ({ fields: fields.map(([ref, value]) => ({ ref, value })) });

describe("personal details guard", () => {
  test("a made-up name or phone is refused, and the message names the fields", () => {
    const error = checkPersonalValues("browser_fill_form", fill(["2:14", "John Doe"], ["2:15", "true"], ["2:23", "555-123-4567"]), {
      task: "fill this google form",
      results: [SNAPSHOT],
    });
    assert.match(error ?? "", /^ERROR POLICY_BLOCKED/);
    assert.match(error!, /2:14 "Full name \*" = "John Doe"/);
    assert.match(error!, /2:23 "Phone number/);
  });

  test("values the user gave pass, and so do facts and non-personal answers", () => {
    const ctx = { task: 'fill it with name "Sahil Sharma", phone +91 98765 43210', results: [SNAPSHOT] };
    assert.equal(checkPersonalValues("browser_fill_form", fill(["2:14", "Sahil Sharma"], ["2:23", "9876543210"], ["2:21", "Paris"]), ctx), null);
    // "name of the hackathon" is not a personal field.
    assert.equal(checkPersonalValues("browser_type", { ref: "2:22", text: "HackOn" }, ctx), null);
  });

  test("the question a field belongs to counts (Google Forms 'Your answer' boxes)", () => {
    const error = checkPersonalValues("browser_type", { ref: "2:24", text: "Asha" }, { task: "fill the form", results: [SNAPSHOT] });
    assert.match(error ?? "", /POLICY_BLOCKED/);
  });

  test("a value shown on the page passes, and so does anything when the user asked for made-up data", () => {
    const page = `${SNAPSHOT}\nSigned in as Priya Nair`;
    assert.equal(checkPersonalValues("browser_type", { ref: "2:14", text: "Priya Nair" }, { task: "fill the form", results: [page] }), null);
    assert.equal(checkPersonalValues("browser_type", { ref: "2:14", text: "John Doe" }, { task: "fill the form with dummy data", results: [SNAPSHOT] }), null);
  });

  test("dummy data is allowed however the user says it, English, Hinglish or Devanagari", () => {
    for (const task of ["use test details", "make something up", "fill with mock values", "kuch bhi daal do", "डमी डिटेल्स के साथ फॉर्म भर दो"]) {
      assert.equal(allowsMadeUpValues(task), true, task);
    }
    for (const task of ["fill the form", "test whether the form submits", "my name is Asha"]) {
      assert.equal(allowsMadeUpValues(task), false, task);
    }
  });
});
