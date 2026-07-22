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

# Run task-success eval (needs DataHub running)
DATAHUB_GMS_URL=http://localhost:8080 npm run eval

# Run live agent eval (needs Gemini API key)
GEMINI_API_KEY=... DATAHUB_GMS_URL=http://localhost:8080 npm run eval:agent
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

  Tasks evaluated:      18 (13 core + 5 DataHub)
  Core tasks (13/13):   100% proxy and direct both pass
  Agreement rate:       Both paths make identical tool choices
  DataHub tasks:        Pass when DataHub GMS is running

  ✓ Compact signatures do NOT confuse the agent on these tasks.
```

## How It Works

```
Agent ←→ Schema Gatekeeper ←→ Real Backends
           (proxy)
           ├─ filesystem server (stdio MCP)
           ├─ DataHub GMS (direct GraphQL — no Python dependency)
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
| `data-catalog` | `dh_search`, `dh_get_entities`, `dh_list_schema`, `dh_get_lineage`, `dh_lineage_paths`, `dh_get_queries`, `dh_draft_sql`, `dh_add_tags`, `dh_add_terms`, `dh_update_desc`, `dh_search_docs`, `dh_save_doc` | **Real** (DataHub GraphQL) |
| `git` | `git_status`, `git_diff`, `git_log` | **Real** (child_process) |
| `system` | `run_command`, `get_environment` | **Real** (child_process) |
| `database` | `query`, `list_tables`, `describe_table` | Simulated |
| `web-search` | `web_search`, `fetch_url` | Simulated |
| `browser` | `open_page`, `click_element`, `screenshot`, `evaluate_js` | Simulated |
| `ai-inference` | `generate_text`, `summarize` | Simulated |

**21/28 tools have real backends.** DataHub integration provides 12 real data catalog tools via direct GraphQL calls to the GMS API.

## DataHub Integration

This project integrates [DataHub](https://datahub.com/) — the open-source metadata platform — as a first-class tool source. Unlike other MCP integrations that depend on spawning Python processes (`uvx mcp-server-datahub`), this proxy calls DataHub's GraphQL API directly:

- **Zero Python dependency** — pure TypeScript, no `uvx` or `pip` needed
- **Sub-second responses** — direct HTTP, no child process spawn overhead
- **Full CRUD** — search, inspect, tag, annotate, and draft SQL against real datasets
- **Graceful degradation** — tools return helpful errors when DataHub is unavailable

### What the 12 DataHub tools do

| Tool | Purpose |
|------|---------|
| `dh_search` | Search across all data assets by keyword |
| `dh_get_entities` | Get detailed info for specific entity URNs |
| `dh_list_schema` | List column-level schema with types, tags, and glossary terms |
| `dh_get_lineage` | Trace upstream/downstream data flow with hop control |
| `dh_lineage_paths` | Find paths between two specific entities |
| `dh_get_queries` | Fetch query history for a dataset |
| `dh_draft_sql` | Draft SQL using real schema context |
| `dh_add_tags` | Add classification tags to entities |
| `dh_add_terms` | Add business glossary terms for governance |
| `dh_update_desc` | Update entity descriptions |
| `dh_search_docs` | Search DataHub knowledge documents |
| `dh_save_doc` | Save runbooks, FAQs, and notes |

### Running with DataHub

```bash
# Start local DataHub via Docker
datahub docker quickstart

# Load sample data
datahub docker ingest-sample-data

# Start proxy with DataHub connection
DATAHUB_GMS_URL=http://localhost:8080 npm start
```

The proxy auto-detects the `DATAHUB_GMS_URL` environment variable and routes all `dh_*` tools through direct GraphQL. When DataHub is unavailable, tools return graceful error messages.

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

## Live Agent Evaluation

```bash
GEMINI_API_KEY=... DATAHUB_GMS_URL=http://localhost:8080 npm run eval:agent
```

Runs a real Gemini 2.5 Flash model against the 3 gateway tools only. Tests 12 tasks:
- 6 file/ops tasks (read, write, git, shell, multi-category, ambiguous)
- 6 DataHub tasks (search, schema, lineage, SQL, cross-category, ambiguous)

Measures whether compact signatures cause the agent to make different tool choices than it would with full schemas.

## Hackathon

Built for [Build with DataHub: The Agent Hackathon](https://datahub.devpost.com/) (deadline Aug 10, 2026).

**Challenge:** Agents That Do Real Work + Metadata-Aware Code Generation.

Schema Gatekeeper demonstrates how MCP tool schemas can be compressed on-the-fly, reducing token cost by 93% while maintaining 100% task success rate — including 12 real DataHub tools for data discovery, lineage, and governance.

## Tech Stack

- Node.js + TypeScript (tsx)
- `@modelcontextprotocol/sdk` v1.29.0
- `@modelcontextprotocol/server-filesystem`
- `@google/genai` (Gemini agent eval)
- DataHub GraphQL API (direct HTTP — no Python dependency)
- Zod v4.4.3

## Limitations

- **Fixed categories are hand-curated.** Semantic/embedding-based search would be more robust at 100+ tools.
- **`run_command` has basic sandboxing, not real security.** Production use should use gVisor/nsjail/container isolation.
- **Added latency per tool use.** +1 round-trip for category discovery. Net cost for simple one-shot tasks, net benefit for multi-turn conversations.
- **Gemini API quota limits apply.** Free tier has per-project and per-day quotas.

## License

MIT
