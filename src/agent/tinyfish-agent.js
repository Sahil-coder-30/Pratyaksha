/**
 * PRATYAKSHA x TinyFish Agent Integration
 * Integrates TinyFish Agent API as a cloud execution engine.
 * Mirrors LangGraphAgent interface for drop-in use in panel.js.
 */

const TINYFISH_BASE = 'https://agent.tinyfish.ai/v1';

export class TinyFishAgent {
  constructor({ apiKey, onEvent } = {}) {
    this.apiKey = apiKey;
    this.onEvent = onEvent || (() => {});
    this.runId = null;
    this.isCancelled = false;
    this._abortController = null;
  }

  async run(task, activeTab) {
    const tab = activeTab || {};
    this.isCancelled = false;
    this._abortController = new AbortController();
    const targetUrl = tab.url || '';
    const goal = targetUrl ? (task + ' (Current page: ' + targetUrl + ')') : task;

    this._emit('THINKING', { phase: 'intake', text: 'TinyFish Agent starting task on: ' + (targetUrl || 'cloud browser'), step: 0 });

    try {
      return await this._runSSE(targetUrl || 'https://www.google.com', goal);
    } catch (err) {
      if (this.isCancelled || err.name === 'AbortError') {
        return { success: false, summary: 'Task cancelled by user.', steps: 0 };
      }
      throw err;
    }
  }

  async cancel() {
    this.isCancelled = true;
    if (this._abortController) this._abortController.abort();
    if (this.runId) {
      try {
        await fetch(TINYFISH_BASE + '/runs/' + this.runId + '/cancel', { method: 'POST', headers: this._headers() });
      } catch (_) {}
    }
  }

  _headers() {
    return { 'X-API-Key': this.apiKey, 'Content-Type': 'application/json' };
  }

  _emit(type, payload) {
    try { this.onEvent(Object.assign({ type }, payload)); } catch (_) {}
  }

  async _runSSE(url, goal) {
    const response = await fetch(TINYFISH_BASE + '/automation/run-sse', {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify({ url, goal }),
      signal: this._abortController.signal
    });

    if (!response.ok) {
      let errText = '';
      try { errText = await response.text(); } catch (_) {}
      throw new Error('TinyFish API error ' + response.status + ': ' + (errText || response.statusText));
    }

    return await this._processSSEStream(response);
  }

  async _processSSEStream(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let stepCount = 0;

    try {
      while (true) {
        if (this.isCancelled) break;
        const chunk = await reader.read();
        if (chunk.done) break;

        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          let event;
          try { event = JSON.parse(trimmed.slice(6)); } catch (_) { continue; }

          if (event.type === 'STARTED') {
            this.runId = event.run_id;
            this._emit('THINKING', { phase: 'intake', text: 'TinyFish run started (ID: ' + event.run_id + ')', step: 0 });
          } else if (event.type === 'STREAMING_URL') {
            this._emit('THINKING', { phase: 'perceive', text: 'Live browser stream available', streamingUrl: event.streaming_url, step: stepCount });
          } else if (event.type === 'PROGRESS') {
            stepCount++;
            this._emit('THINKING', { phase: 'action', text: event.purpose || 'Working...', step: stepCount });
          } else if (event.type === 'COMPLETE') {
            const success = event.status === 'COMPLETED';
            let summary = '';
            if (success && event.result != null) {
              summary = typeof event.result === 'string' ? event.result : JSON.stringify(event.result, null, 2);
            } else if (!success) {
              const err = event.error || {};
              summary = err.message || err.help_message || ('Task ' + event.status.toLowerCase() + '.');
            }
            this._emit('THINKING', { phase: success ? 'finish' : 'error', text: success ? ('TinyFish completed in ' + stepCount + ' step(s).') : ('TinyFish: ' + summary), step: stepCount });
            return { success: success, summary: summary, steps: stepCount, runId: event.run_id };
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (this.isCancelled) {
      return { success: false, summary: 'Task cancelled by user.', steps: stepCount };
    }
    if (this.runId) return await this._pollForResult(stepCount);
    return { success: false, summary: 'TinyFish stream ended without a result.', steps: stepCount };
  }

  async _pollForResult(stepCount) {
    const start = Date.now();
    const maxWaitMs = 120000;
    const terminal = ['COMPLETED', 'FAILED', 'CANCELLED'];
    this._emit('THINKING', { phase: 'perceive', text: 'SSE stream closed - polling for final result...', step: stepCount });

    while (Date.now() - start < maxWaitMs) {
      if (this.isCancelled) break;
      await new Promise(function(r) { setTimeout(r, 3000); });
      let run;
      try {
        const res = await fetch(TINYFISH_BASE + '/runs/' + this.runId, { headers: this._headers() });
        run = await res.json();
      } catch (_) { continue; }
      if (terminal.indexOf(run.status) >= 0) {
        const success = run.status === 'COMPLETED';
        const summary = success ? JSON.stringify(run.result) : ((run.error && run.error.message) || ('Run ' + run.status.toLowerCase() + '.'));
        return { success: success, summary: summary, steps: run.num_of_steps || stepCount, runId: this.runId };
      }
    }
    return { success: false, summary: 'TinyFish run timed out during polling.', steps: stepCount };
  }
}

export function validateTinyFishKey(apiKey) {
  return typeof apiKey === 'string' && apiKey.trim().length > 10;
}
