# On-Demand Schema Gatekeeper

**MCP Tool Schema Proxy — strips tool bloat, streams only what the agent needs.**

## The Problem

Every LLM agent connected to MCP tools receives **all tool schemas upfront** via `tools/list`. With 16+ tools, that's ~1,853 tokens of JSON boilerplate the agent never uses — wasted context, wasted money, wasted latency.

## The Solution

A single MCP proxy that sits between the agent and all tool servers. Instead of dumping every schema, it exposes just **2 tools**:

| Tool | What it does |
|------|-------------|
| `request_skills` | Discover tools by category — returns compact pseudo-markdown signatures |
| `invoke_skill` | Execute a tool by name, forwarding to the real MCP backend |


## Quick Start

```bash
git clone <repo-url>
cd schema-gatekeeper
bash setup.sh
```

Then run it:

```bash
# Option A: Claude Code (free, just needs API key)
claude
# Then ask: "read the file /tmp/gatekeeper-test.txt"

# Option B: Run tests (no account needed)
node --import tsx/esm src/test.ts

# Option C: Run benchmark
node --import tsx/esm src/benchmark.ts

# Option D: Open interactive chart
open demo/chart.html
```

## Benchmark Results

```
── UPFRONT TOOL LOADING ──────────────────────────────────────

  Without proxy  ████████████████████████████████████ 1,853 tokens
  With proxy     ███░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  159 tokens

  ✦ 91% fewer tokens

── 5-Turn Conversation ───────────────────────────────────────

  Without proxy: 1,994 tokens    With proxy: 534 tokens

  ✦ 73% total savings
```

## How It Works

```
Agent ←→ Schema Gatekeeper ←→ Real MCP Servers
           (proxy)
           ├─ filesystem server (stdio)
           ├─ database server (stdio)
           ├─ git server (stdio)
           └─ ... (extensible)
```

**3-step pattern:**
1. `request_skills("file-operations")` → compact signatures
2. Agent understands `read_file(path!:string)` syntax
3. `invoke_skill("read_file", {path: "/tmp/foo.txt"})` → proxied to real server

## 16 Tools Across 7 Categories

| Category | Tools | Backend |
|----------|-------|---------|
| `file-operations` | `read_file`, `write_file`, `list_directory`, `search_files` | **Real** |
| `database` | `query`, `list_tables`, `describe_table` | Simulated |
| `web-search` | `web_search`, `fetch_url` | Simulated |
| `browser` | `open_page`, `click_element`, `screenshot`, `evaluate_js` | Simulated |
| `git` | `git_status`, `git_diff`, `git_log`, `git_commit` | Simulated |
| `ai-inference` | `generate_text`, `summarize` | Simulated |
| `system` | `run_command`, `list_processes`, `system_info` | Simulated |

## Tech Stack

- Node.js + TypeScript (tsx)
- `@modelcontextprotocol/sdk` v1.29.0
- `@modelcontextprotocol/server-filesystem`
- Zod v4.4.3

## Project Structure

```
src/
├── index.ts       # MCP server (2 tools)
├── types.ts       # Shared types
├── registry.ts    # 16 tool schemas
├── compactor.ts   # Schema compaction
├── proxy.ts       # MCP client proxy
├── metrics.ts     # Token counting
├── benchmark.ts   # CLI benchmark
└── test.ts        # 15 E2E tests
demo/
├── chart.html     # Chart.js visualization
└── chart-data.json
```

## License

MIT
