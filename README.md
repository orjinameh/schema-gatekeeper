# Schema Gatekeeper

**MCP Tool Schema Proxy — strips tool bloat, streams only what the agent needs.**

## The Problem

Every LLM agent connected to MCP tools receives **all tool schemas upfront** via `tools/list`. With 28+ tools, that's ~3,636 tokens of JSON boilerplate the agent never uses — wasted context, wasted money, wasted latency.

## The Solution

A single MCP proxy that sits between the agent and all tool servers. Instead of dumping every schema, it exposes just **3 tools**:

| Tool | What it does |
|------|-------------|
| `request_skills` | Discover tools by category — returns compact pseudo-markdown signatures |
| `invoke_skill` | Execute a tool by name, forwarding to the real backend |
| `search_tools` | Keyword search over tool descriptions (escape hatch for unknown categories) |

## Quick Start

```bash
git clone <repo-url>
cd schema-gatekeeper
npm install
```

Then run it:

```bash
# Start the MCP proxy server
npm start

# Run tests (no account needed)
npm test

# Run benchmark
npm run benchmark

# Run task-success eval
npm run eval

# Run live agent eval (needs API key)
npm run eval:agent

# Open interactive chart
open demo/chart.html
```

## Benchmark Results

```
── UPFRONT TOOL LOADING ──────────────────────────────────────

  Without proxy  ████████████████████████████████████ 3,636 tokens
  With proxy     ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  238 tokens

  ✦ 93% fewer tokens

── 5-Turn Conversation ───────────────────────────────────────

  Without proxy: 3,777 tokens    With proxy: 613 tokens

  ✦ 84% total savings
```

## Task-Success Evaluation

The benchmark above measures tokens. This measures whether the agent actually picks the right tool:

```
── TASK-SUCCESS: PROXY vs DIRECT ─────────────────────────────

  Tasks evaluated:      18 (13 scripted + 5 DataHub-specific)
  Proxy path passed:    18/18 (100%)
  Direct path passed:   18/18 (100%)
  Agreement rate:       18/18

  ✓ Compact signatures do NOT confuse the agent on these tasks.
```

## How It Works

```
Agent ←→ Schema Gatekeeper ←→ Real Backends
           (proxy)
           ├─ filesystem server (stdio MCP)
           ├─ DataHub MCP server (stdio or HTTP)
           ├─ git (child_process — direct exec)
           ├─ system (child_process — direct exec)
           └─ ... (extensible)
```

**3-step pattern (known category):**
1. `request_skills("file-operations")` → compact signatures
2. Agent understands `read_file(path!:string)` syntax
3. `invoke_skill("read_file", {path: "/tmp/foo.txt"})` → proxied to real server

**Fallback (unknown category):**
1. `search_tools({ query: "screenshot capture" })` → matching tools
2. `invoke_skill("screenshot", { selector: ".hero" })` → proxied to real server

## 28 Tools Across 8 Categories

| Category | Tools | Backend |
|----------|-------|---------|
| `file-operations` | `read_file`, `write_file`, `list_directory`, `search_files` | **Real** (MCP server) |
| `data-catalog` | `dh_search`, `dh_get_entities`, `dh_list_schema`, `dh_get_lineage`, `dh_lineage_paths`, `dh_get_queries`, `dh_draft_sql`, `dh_add_tags`, `dh_add_terms`, `dh_update_desc`, `dh_search_docs`, `dh_save_doc` | **Real** (DataHub MCP server) |
| `git` | `git_status`, `git_diff`, `git_log` | **Real** (child_process) |
| `system` | `run_command`, `get_environment` | **Real** (child_process) |
| `database` | `query`, `list_tables`, `describe_table` | Simulated |
| `web-search` | `web_search`, `fetch_url` | Simulated |
| `browser` | `open_page`, `click_element`, `screenshot`, `evaluate_js` | Simulated |
| `ai-inference` | `generate_text`, `summarize` | Simulated |

**16/28 tools have real backends.** DataHub integration provides 12 real data catalog tools via the official [DataHub MCP Server](https://github.com/acryldata/mcp-server-datahub).

## DataHub Integration

This project integrates [DataHub](https://datahub.com/) — the open-source context platform — as a first-class tool source. The proxy connects to DataHub's MCP server, giving LLM agents access to:

- **Structured search** across data assets with boolean logic and filters
- **Column and table-level lineage** to trace data flow
- **Schema exploration** with keyword filtering
- **Query intelligence** — see how analysts actually query tables
- **Metadata mutations** — add tags, glossary terms, and descriptions
- **Document management** — search and save knowledge articles

### Running with DataHub

```bash
# Option A: Local DataHub via Docker
datahub docker quickstart
datahub init --username datahub --password datahub
datahub datapack load showcase-ecommerce

# Set env vars and start proxy
DATAHUB_GMS_URL=http://localhost:8080 DATAHUB_GMS_TOKEN="" npm start
```

The proxy auto-detects DataHub tools via `uvx mcp-server-datahub@latest` and falls back gracefully when DataHub is unavailable.

## E2E Tests

```bash
npm test
```

All 21 tests pass, covering:
- Gateway tool registration (3 tools)
- Category discovery (all 8 categories)
- Real tool execution (file ops, git, system)
- Sandbox enforcement (rm -rf, sudo blocked)
- Token savings measurement (93% upfront, 84% conversation)
- Search across tool registry

## Hackathon

Built for [Build with DataHub: The Agent Hackathon](https://datahub.devpost.com/) (deadline Aug 10, 2026).

**Challenge:** Agents That Do Real Work + Metadata-Aware Code Generation.

Schema Gatekeeper demonstrates how MCP tool schemas can be compressed on-the-fly, reducing token cost by 93% while maintaining 100% task success rate — including 12 real DataHub tools for data discovery, lineage, and governance.

## Tech Stack

- Node.js + TypeScript (tsx)
- `@modelcontextprotocol/sdk` v1.29.0
- `@modelcontextprotocol/server-filesystem`
- DataHub MCP Server (`uvx mcp-server-datahub@latest`)
- Zod v4.4.3

## Limitations

- **Fixed categories are hand-curated.** Semantic/embedding-based search would be more robust at 100+ tools.
- **`run_command` has basic sandboxing, not real security.** Production use should use gVisor/nsjail/container isolation.
- **Added latency per tool use.** +1 round-trip for category discovery. Net cost for simple one-shot tasks, net benefit for multi-turn conversations.
- **Task-success eval is scripted.** Live LLM agent evaluation is the next milestone.

## License

MIT
