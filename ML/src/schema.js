
(function (root) {
  "use strict";

  root.PrivacyAgentSchemas = {
    MESSAGE_TYPES: {
      PAGE_CONTEXT: "PAGE_CONTEXT",
      CONTEXT_ACK: "CONTEXT_ACK"
    },

    createPageContext({
      url,
      title,
      viewport,
      elements,
      capturedAt
    }) {
      return {
        schemaVersion: "1.0",
        type: "PAGE_CONTEXT",
        url,
        title,
        capturedAt,
        viewport,
        elements
      };
    }
  };
})(globalThis);
