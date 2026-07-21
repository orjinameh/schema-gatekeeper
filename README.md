# On-Demand Schema Gatekeeper

**MCP Tool Schema Proxy — strips tool bloat, streams only what the agent needs.**

## The Problem

Every LLM agent connected to MCP tools receives **all tool schemas upfront** via `tools/list`. With 16+ tools, that's ~1,853 tokens of JSON boilerplate the agent never uses — wasted context, wasted money, wasted latency.

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

# Option D: Run task-success eval
node --import tsx/esm src/eval.ts

# Option E: Open interactive chart
open demo/chart.html
```

## Benchmark Results

```
── UPFRONT TOOL LOADING ──────────────────────────────────────

  Without proxy  ████████████████████████████████████ 1,853 tokens
  With proxy     ███░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  231 tokens

  ✦ 88% fewer tokens

── 5-Turn Conversation ───────────────────────────────────────

  Without proxy: 1,994 tokens    With proxy: 606 tokens

  ✦ 70% total savings
```

## Task-Success Evaluation

The benchmark above measures tokens. This measures whether the agent actually picks the right tool:

```
── TASK-SUCCESS: PROXY vs DIRECT ─────────────────────────────

  Tasks evaluated:      9
  Proxy path passed:    9/9 (100%)
  Direct path passed:   9/9 (100%)
  Agreement rate:       9/9

  ✓ Compact signatures do NOT confuse the agent on these tasks.
    The tradeoff is latency (+54% discovery overhead) for token savings (-88%).
```

The proxy path and direct path achieve identical task success. The cost is latency from discovery round-trips, not accuracy.

## How It Works

```
Agent ←→ Schema Gatekeeper ←→ Real Backends
           (proxy)
           ├─ filesystem server (stdio MCP)
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

## 16 Tools Across 7 Categories

| Category | Tools | Backend |
|----------|-------|---------|
| `file-operations` | `read_file`, `write_file`, `list_directory`, `search_files` | **Real** (MCP server) |
| `git` | `git_status`, `git_diff`, `git_log` | **Real** (child_process) |
| `system` | `run_command`, `get_environment` | **Real** (child_process) |
| `database` | `query`, `list_tables`, `describe_table` | Simulated |
| `web-search` | `web_search`, `fetch_url` | Simulated |
| `browser` | `open_page`, `click_element`, `screenshot`, `evaluate_js` | Simulated |
| `ai-inference` | `generate_text`, `summarize` | Simulated |

**10/16 tools have real backends.** The remaining 6 are simulated (database, web-search, browser, ai-inference).

## Limitations (Honest Assessment)

**This is a proof-of-concept, not production infrastructure.**

- **10/16 tools are real, 6 are simulated.** `file-operations` uses the official MCP filesystem server. `git` and `system` tools shell out via `child_process.exec`. `database`, `web-search`, `browser`, and `ai-inference` remain mocked. These could all be wired to real servers (SQLite MCP, Brave API, Playwright, Anthropic API) but haven't been yet.

- **Fixed categories are fragile.** The 7 categories in `registry.ts` are hand-curated. If a new tool doesn't fit cleanly, or the agent doesn't know the taxonomy, it has to guess. `search_tools` mitigates this with keyword fallback, but semantic/embedding-based search would be more robust at 100+ tools.

- **Added latency per tool use.** Every tool invocation through the proxy requires a prior `request_skills` call (category discovery). That's +1 round-trip per tool use — a net latency cost for simple one-shot tasks. The eval shows +54% latency overhead across 9 tasks.

- **Token savings scale with tool count.** The 88% upfront savings are against 16 tools. At 50+ tools, savings would be larger. At 5 tools, they'd be negligible. This pattern only pays off when tool count is high enough to waste meaningful context.

- **Task-success eval is promising but narrow.** 9/9 agreement on real tasks is strong, but these are single-step invocations. Multi-step tasks with ambiguous tool selection (e.g., "analyze this codebase" requiring file reads + git log + shell commands in sequence) would stress-test the proxy more. That's the next evaluation to run.

- **Single contributor, no external validation.** This is a hackathon project. The eval results are reproducible (`npm run eval`) but haven't been independently verified.

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
├── proxy.ts       # MCP client + direct exec backends
├── metrics.ts     # Token counting + latency simulation
├── benchmark.ts   # CLI benchmark
├── eval.ts        # Task-success evaluation (proxy vs direct)
└── test.ts        # 15+ E2E tests
demo/
├── chart.html     # Chart.js visualization
└── chart-data.json
```

## License

MIT
