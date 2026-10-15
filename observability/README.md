# PRATYAKSHA Local Observability Stack (Prometheus + Grafana + Grafana Loki)

## 1. Architecture Analysis

**PRATYAKSHA (`pratyaksha`)** is a Chrome Manifest V3 (MV3) browser extension powered by a LangChain + LangGraph 8-node `StateGraph` (`src/`) that compiles into `pratyaksha-extension/agent/graph-engine.js` via `esbuild` (`build.js`).

### Why a Local Telemetry Collector Bridge is Required
1. **Browser Sandbox Constraints**: Chrome MV3 extensions execute inside a browser Service Worker and Side Panel (`chrome-extension://*`). They cannot open a listening TCP port for **Prometheus** to scrape (`GET /metrics`) or write directly to host disk files for **Promtail**.
2. **Existing FaultKit + Pino Logger**: The project already includes `faultkit@^1.1.0` (`faultkit/logger`), which provides a native Pino/Grafana-Loki structured JSON logger. In `build.js`, `stubFaultkitLoggerPlugin` stubs `faultkit/logger` in the browser bundle because Pino requires Node.js streams.
3. **Zero-Latency Local Bridge (`observability/collector.js`)**:
   - `AgentEventEmitter` (`src/ui/agent-events.js`) already sanitizes all events through `sanitizeEventPayload()` (`src/safety/privacy.js`), stripping API keys and passwords.
   - It now forwards sanitized lifecycle events via a non-blocking `fetch('http://localhost:9464/v1/telemetry')` to the local Node.js collector (`observability/collector.js`).
   - The collector uses **`faultkit/logger`** to write ISO-8601 single-line JSON logs to `observability/logs/pratyaksha.log` (tailed by **Promtail**) and pushes directly to **Grafana Loki** (`http://localhost:3100/loki/api/v1/push`), while exposing **Prometheus** counters, gauges, and histograms at `http://localhost:9464/metrics`.

## 2. Step-by-Step Local Setup Guide

### Step 1: Start Prometheus, Grafana Loki, Promtail, and Grafana
Make sure Docker Desktop is running on your Mac, then from the project root (`/Users/home/Desktop/PS- 26171`) run:

```bash
npm run telemetry:up
```
*(Or directly: `docker compose -f observability/docker-compose.yml up -d`)*

### Step 2: Start the Local Telemetry Collector (Node.js Bridge)
In a terminal at the project root, start the collector (with `--seed` to emit an initial sample agent run immediately):

```bash
npm run telemetry:seed
```
*(Or run `npm run telemetry:collector` to start without sample seed data, and trigger simulated agent runs anytime with `npm run telemetry:simulate`.)*

### Step 3: Rebuild & Reload the Chrome Extension
Whenever `src/` changes, rebuild the extension bundle and reload it in Chrome:

```bash
npm run build
```
Then open `chrome://extensions/` and click the **Reload** icon on **PRATYAKSHA — Privacy-First Browser Agent** (loaded from `build/` or `pratyaksha-extension/`). Every task you run in the Side Panel will now stream metrics and structured logs in real time.

### Step 4: Open Your Dashboards
- **Grafana Dashboard (Pre-provisioned)**: [http://localhost:3000/d/pratyaksha-observability](http://localhost:3000/d/pratyaksha-observability) (Anonymous Admin enabled; or login with `admin` / `admin`)
- **Prometheus UI**: [http://localhost:9090](http://localhost:9090)
- **Raw Collector Metrics**: [http://localhost:9464/metrics](http://localhost:9464/metrics)
- **Collector Health Check**: [http://localhost:9464/health](http://localhost:9464/health)
- **Loki Readiness**: [http://localhost:3100/ready](http://localhost:3100/ready)

## 3. Useful PromQL & LogQL Queries

### Prometheus (PromQL)
- **Completed Tasks by Model**: `sum by (provider, model) (pratyaksha_tasks_total{status="completed"})`
- **PII Items Shielded by On-Device Vault**: `sum(pratyaksha_pii_anonymized_total)`
- **Browser Tool Calls Breakdown**: `sum by (tool_name) (pratyaksha_tool_calls_total)`
- **FaultKit / Provider Error Rate**: `sum by (code) (pratyaksha_tool_errors_total)`
- **95th Percentile Task Duration**: `histogram_quantile(0.95, sum(rate(pratyaksha_task_duration_seconds_bucket[5m])) by (le))`

### Grafana Loki (LogQL)
- **All PRATYAKSHA Agent Logs**: `{service="pratyaksha"} | json`
- **Filter Error & Warning Logs Only**: `{service="pratyaksha"} | json | level =~ "error|warn|40|50"`
- **Filter Privacy Shield Tokenization Events**: `{service="pratyaksha"} | json | phase="privacy"`
- **Trace a Specific Thread ID**: `{service="pratyaksha"} | json | threadId="th_..."`
