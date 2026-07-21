# On-Demand Schema Gatekeeper

**MCP Tool Schema Proxy — strips tool bloat, streams only what the agent needs.**

## The Problem

Every LLM agent connected to MCP tools receives **all tool schemas upfront** via `tools/list`. With 16+ tools, that's ~1,853 tokens of JSON boilerplate the agent never uses — wasted context, wasted money, wasted latency.

## The Solution

A single MCP proxy that sits between the agent and all tool servers. Instead of dumping every schema, it exposes just **3 tools**:

| Tool | What it does |
|------|-------------|
| `request_skills` | Discover tools by category — returns compact pseudo-markdown signatures |
| `invoke_skill` | Execute a tool by name, forwarding to the real MCP backend |
| `search_tools` | Keyword search over tool descriptions (escape hatch for unknown categories) |

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
  With proxy     ███░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  223 tokens

  ✦ 88% fewer tokens

── 5-Turn Conversation ───────────────────────────────────────

  Without proxy: 1,994 tokens    With proxy: 598 tokens

  ✦ 70% total savings

── LATENCY TRADEOFF ──────────────────────────────────────────

  Tool calls (raw path):     2 calls
  Tool calls (proxy path):   4 calls (+2 discovery round-trips)

  For simple one-shot tasks, the proxy adds latency.
  For multi-turn conversations with many tools, token savings dominate.
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

**3-step pattern (known category):**
1. `request_skills("file-operations")` → compact signatures
2. Agent understands `read_file(path!:string)` syntax
3. `invoke_skill("read_file", {path: "/tmp/foo.txt"})` → proxied to real server

**Fallback (unknown category):**
1. `search_tools({ query: "screenshot capture" })` → matching tools
2. `invoke_skill("screenshot", { selector: ".hero" })` → proxied to real server

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

## Limitations (Honest Assessment)

**This is a proof-of-concept, not production infrastructure.**

- **Most tools are simulated.** Only `file-operations` (4 tools) has a real backend (`@modelcontextprotocol/server-filesystem`). The remaining 12 tools return mock responses. The compaction algorithm works on any schema, but the interesting test — does compacted schema output confuse the agent on complex, real-world schemas? — hasn't been validated at scale.

- **Fixed categories are fragile.** The 7 categories in `registry.ts` are hand-curated. If a new tool doesn't fit cleanly, or the agent doesn't know the taxonomy, it has to guess. `search_tools` mitigates this with keyword fallback, but semantic/embedding-based search would be more robust at 100+ tools.

- **Added latency per tool use.** Every tool invocation through the proxy requires a prior `request_skills` call (category discovery). That's +1 round-trip per tool use — a net latency cost for simple one-shot tasks. The benchmark shows this explicitly: 2 raw tool calls vs. 4 proxy calls in a 5-turn conversation.

- **Token savings scale with tool count.** The 88% upfront savings are against 16 tools. At 50+ tools, savings would be larger. At 5 tools, they'd be negligible. This pattern only pays off when tool count is high enough to waste meaningful context.

- **No real-world agent evaluation.** The benchmark is a token-count simulation, not an agent accuracy test. We haven't measured whether the proxy causes the agent to pick wrong tools more often, or whether compact signatures lose critical nuances from full schemas.

- **No CI before this commit.** Single-commit hackathon POC. GitHub Actions workflow now added.

## Tech Stack

- Node.js + TypeScript (tsx)
- `@modelcontextprotocol/sdk` v1.29.0
- `@modelcontextprotocol/server-filesystem`
- Zod v4.4.3

## Project Structure

```
src/
├── index.ts       # MCP server (3 tools)
├── types.ts       # Shared types
├── registry.ts    # 16 tool schemas
├── compactor.ts   # Schema compaction
├── search.ts      # Keyword tool search
├── proxy.ts       # MCP client proxy
├── metrics.ts     # Token counting + latency simulation
├── benchmark.ts   # CLI benchmark
└── test.ts        # 15+ E2E tests
demo/
├── chart.html     # Chart.js visualization
└── chart-data.json
```

## License

MIT
