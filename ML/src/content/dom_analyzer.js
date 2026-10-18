
(function (root) {
  "use strict";

  const SELECTOR = [
    "input",
    "textarea",
    "select",
    "button",
    "a[href]",
    "[role]",
    "label",
    "h1",
    "h2",
    "h3",
    "p",
    "li",
    "td",
    "th"
  ].join(",");

  const MAX_ELEMENTS = 300;
  const MAX_TEXT_LENGTH = 500;

  function isVisible(element) {
    if (!(element instanceof Element)) return false;

    if (element.closest(
      '[hidden], [aria-hidden="true"], [inert]'
    )) {
      return false;
    }

    const rect = element.getBoundingClientRect();

    if (rect.width <= 0 || rect.height <= 0) {
      return false;
    }

    const style = getComputedStyle(element);

    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity) === 0
    ) {
      return false;
    }

    return true;
  }

  function getElementText(element) {
    // Never read input.value, textarea.value, or selected values.
    // Those may contain passwords, OTPs, or other private data.
    if (
      element.matches("input, textarea, select")
    ) {
      return "";
    }

    const text = (
      element.innerText ||
      element.textContent ||
      ""
    ).replace(/\s+/g, " ").trim();

    return text.slice(0, MAX_TEXT_LENGTH);
  }

  function getAssociatedLabel(element) {
    if (!element.matches("input, textarea, select")) {
      return "";
    }

    const labels = element.labels;

    if (labels && labels.length > 0) {
      return Array.from(labels)
        .map(label => label.innerText.trim())
        .filter(Boolean)
        .join(" ")
        .slice(0, 200);
    }

    return "";
  }

  function getFieldType(element) {
    const tag = element.tagName.toLowerCase();

    if (tag === "textarea") return "textarea";
    if (tag === "select") return "select";

    if (tag === "input") {
      // Do not inspect the field's current value.
      return (
        element.getAttribute("type") || "text"
      ).toLowerCase();
    }

    return null;
  }

  function getBoundingBox(element) {
    const rect = element.getBoundingClientRect();

    // CSS viewport coordinates, not screenshot pixels.
    return {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height
    };
  }

  function analyzeElement(element, index) {
    const tag = element.tagName.toLowerCase();

    const text = getElementText(element);
    const label = getAssociatedLabel(element);

    const ariaLabel =
      element.getAttribute("aria-label") || "";

    const placeholder =
      element.getAttribute("placeholder") || "";

    const autocomplete =
      element.getAttribute("autocomplete") || "";

    const type = getFieldType(element);

    const rect = getBoundingBox(element);

    return {
      id: `dom-${index}`,
      tag,
      role: element.getAttribute("role") || null,
      type,
      text,
      label,
      ariaLabel: ariaLabel.slice(0, 200),
      placeholder: placeholder.slice(0, 200),
      autocomplete: autocomplete.slice(0, 100),
      bbox: rect,
      visible: true
    };
  }

  function analyze() {
    const elements = Array.from(
      document.querySelectorAll(SELECTOR)
    );

    const output = [];
    let skipped = 0;

    for (const element of elements) {
      if (!isVisible(element)) continue;

      if (output.length >= MAX_ELEMENTS) {
        skipped++;
        continue;
      }

      output.push(
        analyzeElement(element, output.length)
      );
    }

    return {
      elements: output,
      truncated: skipped > 0,
      skippedCount: skipped
    };
  }

  root.PrivacyAgentDOM = {
    analyze,
    isVisible
  };
})(globalThis);
