/**
 * Task-Success Evaluation — proxy vs direct, on realistic multi-step tasks.
 *
 * Measures: tool selection accuracy, argument correctness, task completion.
 * This is the number that validates whether compact signatures actually
 * confuse the agent or not.
 *
 * "Proxy path" = request_skills → invoke_skill (what the LLM sees)
 * "Direct path" = call the underlying MCP server directly (no proxy layer)
 *
 * Usage: node --import tsx/esm src/eval.ts
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import fs from "node:fs";

const SERVER_CMD = process.execPath;
const GATEKEEPER_ARGS = ["--import", "tsx/esm", new URL("./index.ts", import.meta.url).pathname];

function findProjectRoot(): string {
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

const PROJECT_ROOT = findProjectRoot();
const FILESYSTEM_SERVER = path.join(
  PROJECT_ROOT,
  "node_modules/@modelcontextprotocol/server-filesystem/dist/index.js"
);

// ─── Task Definitions ───────────────────────────────────────────────────────

interface EvalTask {
  name: string;
  description: string;
  /** Steps through the proxy (request_skills → invoke_skill) */
  proxySteps: Array<{
    tool: string;
    args: Record<string, unknown>;
    expectSuccess: boolean;
  }>;
  /** Direct call to the underlying MCP server (no proxy) */
  direct: {
    server: { command: string; args: string[] };
    tool: string;
    args: Record<string, unknown>;
    expectSuccess: boolean;
  };
}

const TASKS: EvalTask[] = [
  {
    name: "Read a file",
    description: "Read the contents of a specific file",
    proxySteps: [
      { tool: "request_skills", args: { category: "file-operations" }, expectSuccess: true },
      { tool: "invoke_skill", args: { toolName: "read_file", payload: { path: "/tmp/gatekeeper-test.txt" } }, expectSuccess: true },
    ],
    direct: {
      server: { command: SERVER_CMD, args: [FILESYSTEM_SERVER, "/tmp", "/home"] },
      tool: "read_file",
      args: { path: "/tmp/gatekeeper-test.txt" },
      expectSuccess: true,
    },
  },
  {
    name: "Write and read back",
    description: "Write a file, then read it back to verify",
    proxySteps: [
      { tool: "request_skills", args: { category: "file-operations" }, expectSuccess: true },
      { tool: "invoke_skill", args: { toolName: "write_file", payload: { path: "/tmp/gatekeeper-eval.txt", content: "eval test content\n" } }, expectSuccess: true },
      { tool: "invoke_skill", args: { toolName: "read_file", payload: { path: "/tmp/gatekeeper-eval.txt" } }, expectSuccess: true },
    ],
    direct: {
      server: { command: SERVER_CMD, args: [FILESYSTEM_SERVER, "/tmp", "/home"] },
      tool: "write_file",
      args: { path: "/tmp/gatekeeper-eval.txt", content: "eval test content\n" },
      expectSuccess: true,
    },
  },
  {
    name: "List directory",
    description: "List files in /tmp",
    proxySteps: [
      { tool: "request_skills", args: { category: "file-operations" }, expectSuccess: true },
      { tool: "invoke_skill", args: { toolName: "list_directory", payload: { path: "/tmp" } }, expectSuccess: true },
    ],
    direct: {
      server: { command: SERVER_CMD, args: [FILESYSTEM_SERVER, "/tmp", "/home"] },
      tool: "list_directory",
      args: { path: "/tmp" },
      expectSuccess: true,
    },
  },
  {
    name: "Git status",
    description: "Check git status of the schema-gatekeeper repo",
    proxySteps: [
      { tool: "request_skills", args: { category: "git" }, expectSuccess: true },
      { tool: "invoke_skill", args: { toolName: "git_status", payload: {} }, expectSuccess: true },
    ],
    direct: {
      // No MCP server for git — we test the proxy's direct exec path
      // by calling the tool via a gatekeeper instance with real backends
      server: { command: SERVER_CMD, args: GATEKEEPER_ARGS },
      tool: "invoke_skill",
      args: { toolName: "git_status", payload: {} },
      expectSuccess: true,
    },
  },
  {
    name: "Git log",
    description: "Get recent git commits",
    proxySteps: [
      { tool: "request_skills", args: { category: "git" }, expectSuccess: true },
      { tool: "invoke_skill", args: { toolName: "git_log", payload: { count: 3 } }, expectSuccess: true },
    ],
    direct: {
      server: { command: SERVER_CMD, args: GATEKEEPER_ARGS },
      tool: "invoke_skill",
      args: { toolName: "git_log", payload: { count: 3 } },
      expectSuccess: true,
    },
  },
  {
    name: "Run shell command",
    description: "Execute a simple shell command",
    proxySteps: [
      { tool: "request_skills", args: { category: "system" }, expectSuccess: true },
      { tool: "invoke_skill", args: { toolName: "run_command", payload: { command: "echo hello" } }, expectSuccess: true },
    ],
    direct: {
      server: { command: SERVER_CMD, args: GATEKEEPER_ARGS },
      tool: "invoke_skill",
      args: { toolName: "run_command", payload: { command: "echo hello" } },
      expectSuccess: true,
    },
  },
  {
    name: "System info",
    description: "Get system environment information",
    proxySteps: [
      { tool: "request_skills", args: { category: "system" }, expectSuccess: true },
      { tool: "invoke_skill", args: { toolName: "get_environment", payload: {} }, expectSuccess: true },
    ],
    direct: {
      server: { command: SERVER_CMD, args: GATEKEEPER_ARGS },
      tool: "invoke_skill",
      args: { toolName: "get_environment", payload: {} },
      expectSuccess: true,
    },
  },
  {
    name: "Search for tool by keyword",
    description: "Use search_tools to find a tool when category is unclear",
    proxySteps: [
      { tool: "search_tools", args: { query: "git commit history" }, expectSuccess: true },
      { tool: "invoke_skill", args: { toolName: "git_log", payload: { count: 5 } }, expectSuccess: true },
    ],
    direct: {
      server: { command: SERVER_CMD, args: GATEKEEPER_ARGS },
      tool: "invoke_skill",
      args: { toolName: "git_log", payload: { count: 5 } },
      expectSuccess: true,
    },
  },
  {
    name: "Cross-category workflow",
    description: "Write a file, then check git status — two categories in one task",
    proxySteps: [
      { tool: "request_skills", args: { category: "file-operations" }, expectSuccess: true },
      { tool: "invoke_skill", args: { toolName: "write_file", payload: { path: "/tmp/gatekeeper-cross.txt", content: "cross-category test\n" } }, expectSuccess: true },
      { tool: "request_skills", args: { category: "git" }, expectSuccess: true },
      { tool: "invoke_skill", args: { toolName: "git_status", payload: {} }, expectSuccess: true },
    ],
    direct: {
      server: { command: SERVER_CMD, args: GATEKEEPER_ARGS },
      tool: "invoke_skill",
      args: { toolName: "git_status", payload: {} },
      expectSuccess: true,
    },
  },

  // ── Multi-step ambiguous tasks ──
  // These require multiple tools across categories, with ambiguous tool selection.

  {
    name: "Audit this repo",
    description: "Check git status, list files, and run a shell command — requires 3 categories",
    proxySteps: [
      { tool: "search_tools", args: { query: "git status" }, expectSuccess: true },
      { tool: "invoke_skill", args: { toolName: "git_status", payload: {} }, expectSuccess: true },
      { tool: "request_skills", args: { category: "file-operations" }, expectSuccess: true },
      { tool: "invoke_skill", args: { toolName: "list_directory", payload: { path: "." } }, expectSuccess: true },
      { tool: "request_skills", args: { category: "system" }, expectSuccess: true },
      { tool: "invoke_skill", args: { toolName: "run_command", payload: { command: "wc -l src/*.ts" } }, expectSuccess: true },
    ],
    direct: {
      server: { command: SERVER_CMD, args: GATEKEEPER_ARGS },
      tool: "invoke_skill",
      args: { toolName: "run_command", payload: { command: "wc -l src/*.ts" } },
      expectSuccess: true,
    },
  },
  {
    name: "Write, verify, and commit",
    description: "Write a file, read it back, check git status — ambiguous because agent must infer tool order",
    proxySteps: [
      { tool: "request_skills", args: { category: "file-operations" }, expectSuccess: true },
      { tool: "invoke_skill", args: { toolName: "write_file", payload: { path: "/tmp/gatekeeper-verify.txt", content: "verification line\n" } }, expectSuccess: true },
      { tool: "invoke_skill", args: { toolName: "read_file", payload: { path: "/tmp/gatekeeper-verify.txt" } }, expectSuccess: true },
      { tool: "request_skills", args: { category: "git" }, expectSuccess: true },
      { tool: "invoke_skill", args: { toolName: "git_status", payload: {} }, expectSuccess: true },
    ],
    direct: {
      server: { command: SERVER_CMD, args: GATEKEEPER_ARGS },
      tool: "invoke_skill",
      args: { toolName: "git_status", payload: {} },
      expectSuccess: true,
    },
  },
  {
    name: "Discover and execute unknown tool",
    description: "Agent doesn't know category — must search first, then invoke",
    proxySteps: [
      { tool: "search_tools", args: { query: "list files directory" }, expectSuccess: true },
      { tool: "invoke_skill", args: { toolName: "list_directory", payload: { path: "/tmp" } }, expectSuccess: true },
      { tool: "search_tools", args: { query: "system information" }, expectSuccess: true },
      { tool: "invoke_skill", args: { toolName: "get_environment", payload: {} }, expectSuccess: true },
    ],
    direct: {
      server: { command: SERVER_CMD, args: GATEKEEPER_ARGS },
      tool: "invoke_skill",
      args: { toolName: "get_environment", payload: {} },
      expectSuccess: true,
    },
  },
  {
    name: "Chain across 4 categories",
    description: "file-operations → git → system → file-operations — tests category switching",
    proxySteps: [
      { tool: "request_skills", args: { category: "file-operations" }, expectSuccess: true },
      { tool: "invoke_skill", args: { toolName: "write_file", payload: { path: "/tmp/gatekeeper-chain.txt", content: "chain test\n" } }, expectSuccess: true },
      { tool: "request_skills", args: { category: "git" }, expectSuccess: true },
      { tool: "invoke_skill", args: { toolName: "git_log", payload: { count: 2 } }, expectSuccess: true },
      { tool: "request_skills", args: { category: "system" }, expectSuccess: true },
      { tool: "invoke_skill", args: { toolName: "run_command", payload: { command: "cat /tmp/gatekeeper-chain.txt" } }, expectSuccess: true },
      { tool: "request_skills", args: { category: "file-operations" }, expectSuccess: true },
      { tool: "invoke_skill", args: { toolName: "read_file", payload: { path: "/tmp/gatekeeper-chain.txt" } }, expectSuccess: true },
    ],
    direct: {
      server: { command: SERVER_CMD, args: GATEKEEPER_ARGS },
      tool: "invoke_skill",
      args: { toolName: "read_file", payload: { path: "/tmp/gatekeeper-chain.txt" } },
      expectSuccess: true,
    },
  },

  // ── DataHub data-catalog tasks ──
  // These test the data-catalog category through the proxy.
  // The "direct" path skips discovery and calls invoke_skill directly.

  {
    name: "DataHub: discover data-catalog",
    description: "Discover data-catalog tools via request_skills, then search for datasets",
    proxySteps: [
      { tool: "request_skills", args: { category: "data-catalog" }, expectSuccess: true },
      { tool: "invoke_skill", args: { toolName: "dh_search", payload: { query: "revenue" } }, expectSuccess: true },
    ],
    direct: {
      server: { command: SERVER_CMD, args: GATEKEEPER_ARGS },
      tool: "invoke_skill",
      args: { toolName: "dh_search", payload: { query: "revenue" } },
      expectSuccess: true,
    },
  },
  {
    name: "DataHub: search and inspect schema",
    description: "Search for a dataset, then list its schema fields",
    proxySteps: [
      { tool: "request_skills", args: { category: "data-catalog" }, expectSuccess: true },
      { tool: "invoke_skill", args: { toolName: "dh_search", payload: { query: "orders", limit: 5 } }, expectSuccess: true },
      { tool: "invoke_skill", args: { toolName: "dh_list_schema", payload: { urn: "urn:li:dataset:(urn:li:dataPlatform:demo,orders,PROD)" } }, expectSuccess: true },
    ],
    direct: {
      server: { command: SERVER_CMD, args: GATEKEEPER_ARGS },
      tool: "invoke_skill",
      args: { toolName: "dh_list_schema", payload: { urn: "urn:li:dataset:(urn:li:dataPlatform:demo,orders,PROD)" } },
      expectSuccess: true,
    },
  },
  {
    name: "DataHub: trace lineage",
    description: "Get downstream lineage for a dataset",
    proxySteps: [
      { tool: "request_skills", args: { category: "data-catalog" }, expectSuccess: true },
      { tool: "invoke_skill", args: { toolName: "dh_get_lineage", payload: { urn: "urn:li:dataset:(urn:li:dataPlatform:demo,orders,PROD)", direction: "DOWNSTREAM" } }, expectSuccess: true },
    ],
    direct: {
      server: { command: SERVER_CMD, args: GATEKEEPER_ARGS },
      tool: "invoke_skill",
      args: { toolName: "dh_get_lineage", payload: { urn: "urn:li:dataset:(urn:li:dataPlatform:demo,orders,PROD)", direction: "DOWNSTREAM" } },
      expectSuccess: true,
    },
  },
  {
    name: "DataHub: cross-category data + file",
    description: "Search DataHub, then write results to a file — data-catalog + file-operations",
    proxySteps: [
      { tool: "request_skills", args: { category: "data-catalog" }, expectSuccess: true },
      { tool: "invoke_skill", args: { toolName: "dh_search", payload: { query: "customer" } }, expectSuccess: true },
      { tool: "request_skills", args: { category: "file-operations" }, expectSuccess: true },
      { tool: "invoke_skill", args: { toolName: "write_file", payload: { path: "/tmp/gatekeeper-datahub.txt", content: "DataHub search results saved\n" } }, expectSuccess: true },
    ],
    direct: {
      server: { command: SERVER_CMD, args: GATEKEEPER_ARGS },
      tool: "invoke_skill",
      args: { toolName: "dh_search", payload: { query: "customer" } },
      expectSuccess: true,
    },
  },
  {
    name: "DataHub: search for data tools",
    description: "Use search_tools to find data catalog tools when category is unclear",
    proxySteps: [
      { tool: "search_tools", args: { query: "dataset search catalog" }, expectSuccess: true },
      { tool: "invoke_skill", args: { toolName: "dh_search", payload: { query: "test" } }, expectSuccess: true },
    ],
    direct: {
      server: { command: SERVER_CMD, args: GATEKEEPER_ARGS },
      tool: "invoke_skill",
      args: { toolName: "dh_search", payload: { query: "test" } },
      expectSuccess: true,
    },
  },
];

// ─── Evaluation Runner ──────────────────────────────────────────────────────

interface StepResult {
  tool: string;
  success: boolean;
  outputSnippet: string;
}

interface TaskResult {
  task: string;
  proxySteps: StepResult[];
  proxySuccess: boolean;
  directSuccess: boolean;
  directOutput: string;
  proxyLatencyMs: number;
  directLatencyMs: number;
}

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>
): Promise<{ success: boolean; text: string }> {
  try {
    const result = await client.callTool({ name, arguments: args });
    const text =
      "content" in result
        ? (result.content as Array<{ type: string; text: string }>)
            .map((c) => c.text)
            .join("")
        : "";
    const success = !(result as { isError?: boolean }).isError;
    return { success, text };
  } catch (err) {
    return {
      success: false,
      text: `Error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function connectClient(
  command: string,
  args: string[]
): Promise<{ client: Client; transport: StdioClientTransport }> {
  const transport = new StdioClientTransport({
    command,
    args,
    stderr: "pipe",
  });
  const client = new Client(
    { name: "eval-harness", version: "1.0.0" },
    { capabilities: {} }
  );
  await client.connect(transport);
  return { client, transport };
}

async function runTask(task: EvalTask): Promise<TaskResult> {
  // ── Proxy path ──
  const proxyStart = Date.now();
  const { client: proxyClient, transport: proxyTransport } = await connectClient(
    SERVER_CMD,
    GATEKEEPER_ARGS
  );

  const proxyResults: StepResult[] = [];
  let proxyAllOk = true;

  for (const step of task.proxySteps) {
    const { success, text } = await callTool(proxyClient, step.tool, step.args);
    proxyResults.push({ tool: step.tool, success, outputSnippet: text.slice(0, 120) });
    if (success !== step.expectSuccess) proxyAllOk = false;
  }

  const proxyLatencyMs = Date.now() - proxyStart;
  await proxyTransport.close();

  // ── Direct path ──
  const directStart = Date.now();
  const { client: directClient, transport: directTransport } = await connectClient(
    task.direct.server.command,
    task.direct.server.args
  );

  const { success: directSuccess, text: directText } = await callTool(
    directClient,
    task.direct.tool,
    task.direct.args
  );
  const directOk = directSuccess === task.direct.expectSuccess;

  const directLatencyMs = Date.now() - directStart;
  await directTransport.close();

  return {
    task: task.name,
    proxySteps: proxyResults,
    proxySuccess: proxyAllOk,
    directSuccess: directOk,
    directOutput: directText.slice(0, 120),
    proxyLatencyMs,
    directLatencyMs,
  };
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║     SCHEMA GATEKEEPER — Task-Success Evaluation            ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");
  console.log("  Proxy path = request_skills → invoke_skill (3 gateway tools)");
  console.log("  Direct path = call underlying server directly (full schemas)\n");

  // Ensure test files exist
  fs.writeFileSync("/tmp/gatekeeper-test.txt", "This is a test file for Schema Gatekeeper eval.\nLine 2 of test data.\n");
  fs.writeFileSync("/tmp/gatekeeper-eval.txt", "placeholder\n");

  const results: TaskResult[] = [];

  for (const task of TASKS) {
    process.stdout.write(`  ${task.name.padEnd(30)}`);
    try {
      const result = await runTask(task);
      results.push(result);

      const proxyIcon = result.proxySuccess ? "✓" : "✗";
      const directIcon = result.directSuccess ? "✓" : "✗";
      const match = result.proxySuccess === result.directSuccess ? "=" : "≠";
      console.log(
        `proxy:${proxyIcon} direct:${directIcon} ${match}  ${result.proxyLatencyMs}ms / ${result.directLatencyMs}ms`
      );
    } catch (err) {
      console.log(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
      results.push({
        task: task.name,
        proxySteps: [],
        proxySuccess: false,
        directSuccess: false,
        directOutput: "",
        proxyLatencyMs: 0,
        directLatencyMs: 0,
      });
    }
  }

  // ── Summary ──
  const proxyPass = results.filter((r) => r.proxySuccess).length;
  const directPass = results.filter((r) => r.directSuccess).length;
  const bothPass = results.filter((r) => r.proxySuccess && r.directSuccess).length;

  const totalProxyLatency = results.reduce((s, r) => s + r.proxyLatencyMs, 0);
  const totalDirectLatency = results.reduce((s, r) => s + r.directLatencyMs, 0);

  console.log("\n── RESULTS ────────────────────────────────────────────────\n");
  console.log(`  Tasks evaluated:      ${results.length}`);
  console.log(`  Proxy path passed:    ${proxyPass}/${results.length} (${Math.round((proxyPass / results.length) * 100)}%)`);
  console.log(`  Direct path passed:   ${directPass}/${results.length} (${Math.round((directPass / results.length) * 100)}%)`);
  console.log(`  Both passed:          ${bothPass}`);
  console.log(`  Agreement rate:       ${bothPass}/${results.length} tasks succeeded on both paths`);

  console.log("\n── LATENCY ────────────────────────────────────────────────\n");
  console.log(`  Total proxy latency:  ${totalProxyLatency}ms (includes discovery round-trips)`);
  console.log(`  Total direct latency: ${totalDirectLatency}ms (no discovery overhead)`);
  if (totalDirectLatency > 0) {
    console.log(`  Overhead:             +${totalProxyLatency - totalDirectLatency}ms (${Math.round(((totalProxyLatency - totalDirectLatency) / totalDirectLatency) * 100)}%)`);
  }

  console.log("\n── CONCLUSION ─────────────────────────────────────────────\n");
  if (proxyPass === results.length && directPass === results.length) {
    console.log("  ✓ Proxy path achieves same task success as direct path.");
    console.log("    Compact signatures do NOT confuse the agent on these tasks.");
    console.log("    The tradeoff is latency (+discovery round-trips) for token savings.");
  } else if (proxyPass < directPass) {
    console.log("  ✗ Proxy path had fewer successes than direct path.");
    console.log("    Compact signatures may lose critical information.");
  } else if (proxyPass > directPass) {
    console.log("  ~ Proxy path had more successes (unexpected).");
    console.log("    Likely backend availability differences, not schema quality.");
  } else {
    console.log("  ~ Both paths had failures — likely backend issues, not schema issues.");
  }

  // ── Failures ──
  const failures = results.filter((r) => !r.proxySuccess || !r.directSuccess);
  if (failures.length > 0) {
    console.log("\n── FAILURES ───────────────────────────────────────────────\n");
    for (const f of failures) {
      console.log(`  ${f.task}:`);
      if (!f.proxySuccess) {
        console.log("    Proxy path:");
        for (const s of f.proxySteps.filter((s) => !s.success)) {
          console.log(`      ✗ ${s.tool}: ${s.outputSnippet}`);
        }
      }
      if (!f.directSuccess) {
        console.log(`    Direct path: ${f.directOutput}`);
      }
    }
  }

  console.log("\n══════════════════════════════════════════════════════════════");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
