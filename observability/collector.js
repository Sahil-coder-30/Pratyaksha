/**
 * PRATYAKSHA Local Observability Collector (Prometheus + Grafana Loki Bridge)
 *
 * Bridges client-side Chrome MV3 Extension events (`AgentEventEmitter`) and
 * FaultKit structured domain errors to:
 *   1. Prometheus `/metrics` pull endpoint (`http://localhost:9464/metrics`)
 *   2. Grafana Loki structured JSON logs via `faultkit/logger` (`observability/logs/pratyaksha.log` + direct Loki HTTP push)
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from 'faultkit/logger';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.COLLECTOR_PORT || process.env.PORT || 9464);
const LOKI_PUSH_URL = process.env.LOKI_PUSH_URL || 'http://localhost:3100/loki/api/v1/push';
const LOG_DIR = path.join(__dirname, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'pratyaksha.log');

fs.mkdirSync(LOG_DIR, { recursive: true });
const fileStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });

// Dual-stream destination: writes single-line ISO-8601 Pino JSON to both stdout and observability/logs/pratyaksha.log
const dualDestination = {
  write(chunk) {
    process.stdout.write(chunk);
    fileStream.write(chunk);
  }
};

export const logger = createLogger(
  {
    service: 'pratyaksha',
    level: process.env.LOG_LEVEL || 'info'
  },
  dualDestination
);

// ── In-Memory Prometheus Metrics Store ────────────────────────────────────────

const metrics = {
  activeTasks: 0,
  piiAnonymizedTotal: new Map(),      // key: provider
  eventsTotal: new Map(),             // key: type|phase|provider|model
  tasksTotal: new Map(),              // key: provider|model|status
  taskStepsTotal: new Map(),          // key: provider|model
  toolCallsTotal: new Map(),          // key: tool_name|provider
  toolErrorsTotal: new Map(),         // key: code|provider
  approvalsTotal: new Map(),          // key: action (required|granted|rejected)
  recoveryTriggersTotal: new Map(),   // key: provider
  durationBuckets: [0.5, 1, 2.5, 5, 10, 30, 60, 120],
  durationHist: new Map()             // key: provider|model -> { count, sum, buckets: number[] }
};

function incMap(map, key, amount = 1) {
  map.set(key, (map.get(key) || 0) + amount);
}

function observeDuration(provider, model, durationSeconds) {
  const key = `${provider}|${model}`;
  if (!metrics.durationHist.has(key)) {
    metrics.durationHist.set(key, {
      count: 0,
      sum: 0,
      buckets: new Array(metrics.durationBuckets.length).fill(0)
    });
  }
  const entry = metrics.durationHist.get(key);
  entry.count += 1;
  entry.sum += durationSeconds;
  for (let i = 0; i < metrics.durationBuckets.length; i++) {
    if (durationSeconds <= metrics.durationBuckets[i]) {
      entry.buckets[i] += 1;
    }
  }
}

function escapeLabel(val) {
  return String(val ?? 'unknown')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}

/**
 * Push structured log entry directly to Grafana Loki HTTP API (best-effort, non-blocking).
 */
async function pushToLoki(event, level = 'info', msg = '') {
  if (process.env.DISABLE_DIRECT_LOKI_PUSH === 'true') return;
  const nowNs = `${BigInt(Date.now()) * 1000000n}`;
  const logLine = JSON.stringify({
    time: event.isoTimestamp || new Date().toISOString(),
    level,
    service: 'pratyaksha',
    eventType: event.type || 'UNKNOWN',
    phase: event.phase || 'general',
    provider: event.provider || 'mistral',
    model: event.model || 'unknown',
    threadId: event.threadId || null,
    taskId: event.taskId || null,
    toolName: event.toolName || null,
    code: event.code || null,
    step: event.step ?? null,
    steps: event.steps ?? null,
    durationMs: event.durationMs ?? null,
    msg
  });

  const payload = {
    streams: [
      {
        stream: {
          service: 'pratyaksha',
          source: 'collector',
          level,
          event_type: String(event.type || 'UNKNOWN'),
          provider: String(event.provider || 'mistral')
        },
        values: [[nowNs, logLine]]
      }
    ]
  };

  try {
    await fetch(LOKI_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (_) {
    // Loki container might not be running yet; Promtail also tails observability/logs/pratyaksha.log
  }
}

/**
 * Processes an incoming PRATYAKSHA AgentEventEmitter payload.
 */
export function recordTelemetryEvent(event = {}) {
  const type = event.type || 'UNKNOWN';
  const phase = event.phase || (type === 'STATE_CHANGE' ? (event.state || 'state').toLowerCase() : 'none');
  const provider = event.provider || 'mistral';
  const model = event.model || 'codestral-latest';

  incMap(metrics.eventsTotal, `${type}|${phase}|${provider}|${model}`, 1);

  let level = 'info';
  let logMessage = event.text || event.summary || event.label || event.message || `Agent event: ${type}`;

  switch (type) {
    case 'TASK_START':
      metrics.activeTasks += 1;
      incMap(metrics.tasksTotal, `${provider}|${model}|started`, 1);
      logMessage = `Task started: ${event.task || 'unnamed task'}`;
      break;

    case 'THINKING':
      if (event.phase === 'privacy' && Number(event.piiDetectedCount) > 0) {
        incMap(metrics.piiAnonymizedTotal, provider, Number(event.piiDetectedCount));
      }
      if (event.phase === 'recovery') {
        incMap(metrics.recoveryTriggersTotal, provider, 1);
        level = 'warn';
      }
      break;

    case 'TOOL_CALL':
      incMap(metrics.toolCallsTotal, `${event.toolName || 'unknown'}|${provider}`, 1);
      logMessage = `Tool call: ${event.toolName || 'unknown'}`;
      break;

    case 'TOOL_ERROR':
      level = 'error';
      incMap(metrics.toolErrorsTotal, `${event.code || 'EXECUTION_ERROR'}|${provider}`, 1);
      incMap(metrics.tasksTotal, `${provider}|${model}|error`, 1);
      logMessage = event.error || 'Tool execution error';
      break;

    case 'APPROVAL_REQUIRED':
      level = 'warn';
      incMap(metrics.approvalsTotal, 'required', 1);
      logMessage = `Approval required for ${event.toolName || 'action'}: ${event.reason || ''}`;
      break;

    case 'APPROVAL_GRANTED':
      incMap(metrics.approvalsTotal, 'granted', 1);
      logMessage = 'Human approval granted';
      break;

    case 'APPROVAL_REJECTED':
      level = 'warn';
      incMap(metrics.approvalsTotal, 'rejected', 1);
      logMessage = `Human approval rejected: ${event.reason || ''}`;
      break;

    case 'TASK_COMPLETE': {
      metrics.activeTasks = Math.max(0, metrics.activeTasks - 1);
      const status = event.success === false ? 'failed' : 'completed';
      incMap(metrics.tasksTotal, `${provider}|${model}|${status}`, 1);
      if (Number(event.steps) > 0) {
        incMap(metrics.taskStepsTotal, `${provider}|${model}`, Number(event.steps));
      }
      if (Number(event.durationMs) > 0) {
        observeDuration(provider, model, Number(event.durationMs) / 1000);
      }
      logMessage = `Task completed (${status}): ${event.summary || ''}`;
      break;
    }

    case 'BUDGET_REACHED':
      level = 'warn';
      metrics.activeTasks = Math.max(0, metrics.activeTasks - 1);
      incMap(metrics.tasksTotal, `${provider}|${model}|budget_reached`, 1);
      if (Number(event.steps) > 0) {
        incMap(metrics.taskStepsTotal, `${provider}|${model}`, Number(event.steps));
      }
      if (Number(event.durationMs) > 0) {
        observeDuration(provider, model, Number(event.durationMs) / 1000);
      }
      logMessage = `Step budget reached: ${event.summary || ''}`;
      break;

    case 'CANCELLED':
      level = 'warn';
      metrics.activeTasks = Math.max(0, metrics.activeTasks - 1);
      incMap(metrics.tasksTotal, `${provider}|${model}|cancelled`, 1);
      logMessage = event.message || 'Task cancelled by user';
      break;
  }

  // Log via FaultKit Pino logger (writes ISO-8601 JSON to stdout + observability/logs/pratyaksha.log)
  const logContext = {
    eventType: type,
    phase,
    provider,
    model,
    threadId: event.threadId || undefined,
    taskId: event.taskId || undefined,
    toolName: event.toolName || undefined,
    code: event.code || undefined,
    step: event.step ?? undefined,
    steps: event.steps ?? undefined,
    durationMs: event.durationMs ?? undefined
  };

  if (level === 'error') {
    logger.error(logContext, logMessage);
  } else if (level === 'warn') {
    logger.warn(logContext, logMessage);
  } else {
    logger.info(logContext, logMessage);
  }

  // Also push to Loki HTTP API asynchronously
  pushToLoki(event, level, logMessage).catch(() => {});
}

/**
 * Renders all metrics in standard Prometheus text exposition format.
 */
export function renderPrometheusMetrics() {
  const lines = [];

  // 1. Active Tasks Gauge
  lines.push('# HELP pratyaksha_active_tasks Number of currently executing PRATYAKSHA browser agent tasks');
  lines.push('# TYPE pratyaksha_active_tasks gauge');
  lines.push(`pratyaksha_active_tasks ${metrics.activeTasks}`);

  // 2. Events Total Counter
  lines.push('# HELP pratyaksha_events_total Total lifecycle events emitted by the PRATYAKSHA LangGraph agent');
  lines.push('# TYPE pratyaksha_events_total counter');
  for (const [key, val] of metrics.eventsTotal.entries()) {
    const [type, phase, provider, model] = key.split('|');
    lines.push(
      `pratyaksha_events_total{type="${escapeLabel(type)}",phase="${escapeLabel(phase)}",provider="${escapeLabel(provider)}",model="${escapeLabel(model)}"} ${val}`
    );
  }

  // 3. Tasks Total Counter
  lines.push('# HELP pratyaksha_tasks_total Total agent tasks by provider, model, and lifecycle status');
  lines.push('# TYPE pratyaksha_tasks_total counter');
  for (const [key, val] of metrics.tasksTotal.entries()) {
    const [provider, model, status] = key.split('|');
    lines.push(
      `pratyaksha_tasks_total{provider="${escapeLabel(provider)}",model="${escapeLabel(model)}",status="${escapeLabel(status)}"} ${val}`
    );
  }

  // 4. Task Steps Total Counter
  lines.push('# HELP pratyaksha_task_steps_total Total execution steps taken across completed tasks');
  lines.push('# TYPE pratyaksha_task_steps_total counter');
  for (const [key, val] of metrics.taskStepsTotal.entries()) {
    const [provider, model] = key.split('|');
    lines.push(
      `pratyaksha_task_steps_total{provider="${escapeLabel(provider)}",model="${escapeLabel(model)}"} ${val}`
    );
  }

  // 5. Tool Calls Total Counter
  lines.push('# HELP pratyaksha_tool_calls_total Total browser automation tool invocations by tool name');
  lines.push('# TYPE pratyaksha_tool_calls_total counter');
  for (const [key, val] of metrics.toolCallsTotal.entries()) {
    const [toolName, provider] = key.split('|');
    lines.push(
      `pratyaksha_tool_calls_total{tool_name="${escapeLabel(toolName)}",provider="${escapeLabel(provider)}"} ${val}`
    );
  }

  // 6. Tool Errors Total Counter
  lines.push('# HELP pratyaksha_tool_errors_total Total FaultKit domain and execution errors by error code');
  lines.push('# TYPE pratyaksha_tool_errors_total counter');
  for (const [key, val] of metrics.toolErrorsTotal.entries()) {
    const [code, provider] = key.split('|');
    lines.push(
      `pratyaksha_tool_errors_total{code="${escapeLabel(code)}",provider="${escapeLabel(provider)}"} ${val}`
    );
  }

  // 7. PII Anonymized Total Counter
  lines.push('# HELP pratyaksha_pii_anonymized_total Total sensitive PII items tokenized by the on-device Privacy Shield');
  lines.push('# TYPE pratyaksha_pii_anonymized_total counter');
  for (const [provider, val] of metrics.piiAnonymizedTotal.entries()) {
    lines.push(`pratyaksha_pii_anonymized_total{provider="${escapeLabel(provider)}"} ${val}`);
  }

  // 8. Human Approval Interceptions Counter
  lines.push('# HELP pratyaksha_approval_events_total Total human-in-the-loop policy approval events');
  lines.push('# TYPE pratyaksha_approval_events_total counter');
  for (const [action, val] of metrics.approvalsTotal.entries()) {
    lines.push(`pratyaksha_approval_events_total{action="${escapeLabel(action)}"} ${val}`);
  }

  // 9. Recovery Triggers Counter
  lines.push('# HELP pratyaksha_recovery_triggers_total Total LangGraph recovery & backtracking node activations');
  lines.push('# TYPE pratyaksha_recovery_triggers_total counter');
  for (const [provider, val] of metrics.recoveryTriggersTotal.entries()) {
    lines.push(`pratyaksha_recovery_triggers_total{provider="${escapeLabel(provider)}"} ${val}`);
  }

  // 10. Task Duration Histogram
  lines.push('# HELP pratyaksha_task_duration_seconds End-to-end task execution duration in seconds');
  lines.push('# TYPE pratyaksha_task_duration_seconds histogram');
  for (const [key, entry] of metrics.durationHist.entries()) {
    const [provider, model] = key.split('|');
    const labels = `provider="${escapeLabel(provider)}",model="${escapeLabel(model)}"`;
    for (let i = 0; i < metrics.durationBuckets.length; i++) {
      lines.push(
        `pratyaksha_task_duration_seconds_bucket{${labels},le="${metrics.durationBuckets[i]}"} ${entry.buckets[i]}`
      );
    }
    lines.push(`pratyaksha_task_duration_seconds_bucket{${labels},le="+Inf"} ${entry.count}`);
    lines.push(`pratyaksha_task_duration_seconds_sum{${labels}} ${entry.sum.toFixed(4)}`);
    lines.push(`pratyaksha_task_duration_seconds_count{${labels}} ${entry.count}`);
  }

  // 11. Collector Process Metrics
  const mem = process.memoryUsage();
  lines.push('# HELP pratyaksha_collector_uptime_seconds Uptime of the local telemetry collector in seconds');
  lines.push('# TYPE pratyaksha_collector_uptime_seconds gauge');
  lines.push(`pratyaksha_collector_uptime_seconds ${process.uptime().toFixed(2)}`);

  lines.push('# HELP pratyaksha_collector_heap_used_bytes Node.js heap memory used by the collector');
  lines.push('# TYPE pratyaksha_collector_heap_used_bytes gauge');
  lines.push(`pratyaksha_collector_heap_used_bytes ${mem.heapUsed}`);

  return lines.join('\n') + '\n';
}

/**
 * Generates sample PRATYAKSHA telemetry events to verify Prometheus + Grafana + Loki immediately.
 */
export function simulateSampleAgentRun() {
  const threadId = `th_sim_${Date.now()}`;
  const taskId = `task_sim_${Date.now()}`;
  const base = { threadId, taskId, provider: 'mistral', model: 'codestral-latest' };

  recordTelemetryEvent({
    ...base,
    type: 'TASK_START',
    task: 'Fill out vendor onboarding form with Aadhaar [AADHAAR_9F12] and PAN [PAN_3B10]'
  });
  recordTelemetryEvent({
    ...base,
    type: 'THINKING',
    phase: 'privacy',
    piiDetectedCount: 2,
    text: 'Privacy Shield: Anonymized 2 sensitive credential/token item(s).'
  });
  recordTelemetryEvent({
    ...base,
    type: 'THINKING',
    phase: 'plan',
    text: 'Created 3-step execution plan for vendor onboarding portal.'
  });
  recordTelemetryEvent({
    ...base,
    type: 'TOOL_CALL',
    toolName: 'type_text',
    step: 1
  });
  recordTelemetryEvent({
    ...base,
    type: 'TOOL_CALL',
    toolName: 'click_element',
    step: 2
  });
  recordTelemetryEvent({
    ...base,
    type: 'APPROVAL_REQUIRED',
    toolName: 'click_element',
    reason: 'Submitting sensitive vendor registration form'
  });
  recordTelemetryEvent({
    ...base,
    type: 'APPROVAL_GRANTED'
  });
  recordTelemetryEvent({
    ...base,
    type: 'TASK_COMPLETE',
    success: true,
    steps: 3,
    durationMs: 2840,
    summary: 'Vendor onboarding form filled and verified with local PII rehydration.'
  });
}

// ── HTTP Server ───────────────────────────────────────────────────────────────

export function startCollectorServer(port = PORT) {
  const server = http.createServer((req, res) => {
    // Enable CORS for Chrome Extension (chrome-extension://*) and local testbed
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/metrics') {
      const body = renderPrometheusMetrics();
      res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
      res.end(body);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        service: 'pratyaksha-observability-collector',
        metricsEndpoint: `http://localhost:${port}/metrics`,
        telemetryEndpoint: `http://localhost:${port}/v1/telemetry`,
        logFile: LOG_FILE
      }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/simulate') {
      simulateSampleAgentRun();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, message: 'Simulated PRATYAKSHA agent run recorded.' }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/telemetry') {
      let rawBody = '';
      req.on('data', (chunk) => {
        rawBody += chunk;
      });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(rawBody || '{}');
          if (Array.isArray(parsed)) {
            parsed.forEach((ev) => recordTelemetryEvent(ev));
          } else {
            recordTelemetryEvent(parsed);
          }
          res.writeHead(202, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ accepted: true }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ accepted: false, error: err.message }));
        }
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  });

  server.listen(port, () => {
    logger.info(
      {
        port,
        metricsUrl: `http://localhost:${port}/metrics`,
        telemetryUrl: `http://localhost:${port}/v1/telemetry`,
        logFile: LOG_FILE
      },
      'PRATYAKSHA Observability Collector listening'
    );
  });

  return server;
}

if (process.argv[1] === __filename) {
  startCollectorServer(PORT);
  if (process.argv.includes('--seed')) {
    simulateSampleAgentRun();
  }
}
