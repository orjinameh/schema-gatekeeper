/**
 * Live Agent Evaluation — runs real Gemini against the gatekeeper MCP tools.
 *
 * Tests: does a live LLM, given only the 3 gateway tools (request_skills,
 * invoke_skill, search_tools), make correct tool choices for both file/system
 * tasks AND DataHub data-catalog tasks?
 *
 * Usage:
 *   GEMINI_API_KEY=... node --import tsx/esm src/agent-eval.ts
 *
 * Requires: @google/genai (npm install @google/genai)
 */

import { GoogleGenAI, type Content, type Part } from "@google/genai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const SERVER_CMD = process.execPath;
const SERVER_ARGS = [
  "--import",
  "tsx/esm",
  new URL("./index.ts", import.meta.url).pathname,
];

// ─── Task Definitions ───────────────────────────────────────────────────────

interface AgentTask {
  name: string;
  prompt: string;
  expectedSequence: Array<{ tool: string; argsContains?: string }>;
}

const TASKS: AgentTask[] = [
  // ── File/ops tasks ──
  {
    name: "Read a file",
    prompt: "Read the file /tmp/gatekeeper-test.txt",
    expectedSequence: [
      { tool: "request_skills", argsContains: "file-operations" },
      { tool: "invoke_skill", argsContains: "read_file" },
    ],
  },
  {
    name: "Git status",
    prompt: "What's the git status of the current repository?",
    expectedSequence: [
      { tool: "request_skills", argsContains: "git" },
      { tool: "invoke_skill", argsContains: "git_status" },
    ],
  },
  {
    name: "Run a command",
    prompt: "Run the command 'uname -a' and show me the output",
    expectedSequence: [
      { tool: "request_skills", argsContains: "system" },
      { tool: "invoke_skill", argsContains: "run_command" },
    ],
  },
  {
    name: "Write and verify",
    prompt: "Write 'hello world' to /tmp/gatekeeper-agent-test.txt, then read it back to verify",
    expectedSequence: [
      { tool: "request_skills", argsContains: "file-operations" },
      { tool: "invoke_skill", argsContains: "write_file" },
      { tool: "invoke_skill", argsContains: "read_file" },
    ],
  },
  {
    name: "Multi-category: git + file",
    prompt: "Show me the last 3 git commits, then list the files in the src/ directory",
    expectedSequence: [
      { tool: "request_skills", argsContains: "git" },
      { tool: "invoke_skill", argsContains: "git_log" },
      { tool: "request_skills", argsContains: "file-operations" },
      { tool: "invoke_skill", argsContains: "list_directory" },
    ],
  },
  {
    name: "Ambiguous: search then invoke",
    prompt: "I need to find out what operating system this is running on. Can you check?",
    expectedSequence: [
      { tool: "search_tools", argsContains: "" },
      { tool: "invoke_skill", argsContains: "get_environment" },
    ],
  },

  // ── DataHub data-catalog tasks ──
  {
    name: "DataHub: search datasets",
    prompt: "Search for datasets related to 'customers' in our data catalog",
    expectedSequence: [
      { tool: "request_skills", argsContains: "data-catalog" },
      { tool: "invoke_skill", argsContains: "dh_search" },
    ],
  },
  {
    name: "DataHub: list schema",
    prompt: "Show me the schema of the orders dataset in Snowflake (urn:li:dataset:(urn:li:dataPlatform:snowflake,b2fd91.order_entry_db.order_entry.orders,PROD))",
    expectedSequence: [
      { tool: "request_skills", argsContains: "data-catalog" },
      { tool: "invoke_skill", argsContains: "dh_list_schema" },
    ],
  },
  {
    name: "DataHub: trace lineage",
    prompt: "What's the upstream lineage of the orders dataset (urn:li:dataset:(urn:li:dataPlatform:snowflake,b2fd91.order_entry_db.order_entry.orders,PROD))?",
    expectedSequence: [
      { tool: "request_skills", argsContains: "data-catalog" },
      { tool: "invoke_skill", argsContains: "dh_get_lineage" },
    ],
  },
  {
    name: "DataHub: draft SQL",
    prompt: "Draft a SQL query to show total orders by customer using the orders dataset (urn:li:dataset:(urn:li:dataPlatform:snowflake,b2fd91.order_entry_db.order_entry.orders,PROD))",
    expectedSequence: [
      { tool: "request_skills", argsContains: "data-catalog" },
      { tool: "invoke_skill", argsContains: "dh_draft_sql" },
    ],
  },
  {
    name: "DataHub: cross-category search + file",
    prompt: "Search DataHub for 'revenue' datasets and save the results to /tmp/datahub-results.txt",
    expectedSequence: [
      { tool: "request_skills", argsContains: "data-catalog" },
      { tool: "invoke_skill", argsContains: "dh_search" },
      { tool: "request_skills", argsContains: "file-operations" },
      { tool: "invoke_skill", argsContains: "write_file" },
    ],
  },
  {
    name: "DataHub: ambiguous search",
    prompt: "I need to understand the data lineage for our orders table — where does the data come from and where does it flow?",
    expectedSequence: [
      { tool: "request_skills", argsContains: "data-catalog" },
      { tool: "invoke_skill", argsContains: "dh_get_lineage" },
    ],
  },
];

// ─── Agent Runner ───────────────────────────────────────────────────────────

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

interface AgentResult {
  task: string;
  prompt: string;
  toolCalls: ToolCall[];
  response: string;
  matchScore: number;
  totalExpected: number;
  matched: number;
  latencyMs: number;
  error?: string;
}

function getGatewayTools(
  client: Client
): Promise<
  Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }>
> {
  return client.listTools().then(({ tools }) =>
    tools.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      inputSchema: (t as unknown as { inputSchema: Record<string, unknown> })
        .inputSchema,
    }))
  );
}

async function executeTool(
  client: Client,
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  try {
    const result = await client.callTool({ name, arguments: args });
    if ("content" in result) {
      return (result.content as Array<{ type: string; text: string }>)
        .map((c) => c.text)
        .join("");
    }
    return JSON.stringify(result);
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/**
 * Convert MCP tools to Gemini function declarations.
 */
function toGeminiTools(
  tools: Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }>
): Array<{ functionDeclarations: Array<Record<string, unknown>> }> {
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      })),
    },
  ];
}

/**
 * Run a single task through Gemini with MCP tool loop.
 */
async function runAgentTask(
  genai: GoogleGenAI,
  mcpClient: Client,
  tools: Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }>,
  task: AgentTask
): Promise<AgentResult> {
  const start = Date.now();
  const toolCalls: ToolCall[] = [];
  const contents: Content[] = [{ role: "user", parts: [{ text: task.prompt }] }];
  const geminiTools = toGeminiTools(tools);

  for (let round = 0; round < 10; round++) {
    try {
      const response = await genai.models.generateContent({
        model: "gemini-2.5-flash",
        contents,
        config: {
          tools: geminiTools,
          maxOutputTokens: 1024,
        },
      });

      const candidate = response.candidates?.[0];
      if (!candidate?.content?.parts) {
        // No content returned
        const text = response.text ?? "";
        return {
          task: task.name,
          prompt: task.prompt,
          toolCalls,
          response: text,
          matchScore: computeMatch(toolCalls, task),
          totalExpected: task.expectedSequence.length,
          matched: countMatched(toolCalls, task),
          latencyMs: Date.now() - start,
        };
      }

      const parts = candidate.content.parts;
      const functionCalls = parts.filter(
        (p): p is Part & { functionCall: { name: string; args: Record<string, unknown> } } =>
          "functionCall" in p && p.functionCall !== undefined
      );

      if (functionCalls.length === 0) {
        // Agent is done — text response
        const textParts = parts.filter((p): p is Part & { text: string } => "text" in p);
        const responseText = textParts.map((p) => p.text).join("");

        return {
          task: task.name,
          prompt: task.prompt,
          toolCalls,
          response: responseText,
          matchScore: computeMatch(toolCalls, task),
          totalExpected: task.expectedSequence.length,
          matched: countMatched(toolCalls, task),
          latencyMs: Date.now() - start,
        };
      }

      // Execute each function call through MCP and collect results
      const functionResponses: Array<{ functionResponse: { name: string; response: Record<string, unknown> } }> = [];

      for (const fc of functionCalls) {
        const name = fc.functionCall.name;
        const args = fc.functionCall.args;
        toolCalls.push({ name, args });
        const resultText = await executeTool(mcpClient, name, args);
        functionResponses.push({
          functionResponse: {
            name,
            response: { result: resultText },
          },
        });
      }

      // Add assistant message and tool results to conversation
      contents.push({ role: "model", parts: parts as Part[] });
      contents.push({ role: "user", parts: functionResponses as unknown as Part[] });
    } catch (err) {
      return {
        task: task.name,
        prompt: task.prompt,
        toolCalls,
        response: "",
        matchScore: computeMatch(toolCalls, task),
        totalExpected: task.expectedSequence.length,
        matched: countMatched(toolCalls, task),
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return {
    task: task.name,
    prompt: task.prompt,
    toolCalls,
    response: "(max rounds exceeded)",
    matchScore: computeMatch(toolCalls, task),
    totalExpected: task.expectedSequence.length,
    matched: countMatched(toolCalls, task),
    latencyMs: Date.now() - start,
  };
}

// ─── Scoring ────────────────────────────────────────────────────────────────

function countMatched(agentCalls: ToolCall[], task: AgentTask): number {
  const used = new Set<number>();
  let matched = 0;

  for (const expected of task.expectedSequence) {
    for (let i = 0; i < agentCalls.length; i++) {
      if (used.has(i)) continue;
      const call = agentCalls[i];
      if (call.name !== expected.tool) continue;
      if (
        expected.argsContains &&
        !JSON.stringify(call.args).includes(expected.argsContains)
      )
        continue;
      used.add(i);
      matched++;
      break;
    }
  }

  return matched;
}

function computeMatch(agentCalls: ToolCall[], task: AgentTask): number {
  const matched = countMatched(agentCalls, task);
  return task.expectedSequence.length > 0
    ? matched / task.expectedSequence.length
    : 1;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("Error: GEMINI_API_KEY not set.");
    console.error(
      "Usage: GEMINI_API_KEY=... node --import tsx/esm src/agent-eval.ts"
    );
    process.exit(1);
  }

  const genai = new GoogleGenAI({ apiKey });

  console.log(
    "╔══════════════════════════════════════════════════════════════╗"
  );
  console.log(
    "║     SCHEMA GATEKEEPER — Live Agent Evaluation              ║"
  );
  console.log(
    "║     (Gemini 2.5 Flash vs gateway tools only)              ║"
  );
  console.log(
    "╚══════════════════════════════════════════════════════════════╝\n"
  );

  // Connect to gatekeeper MCP server
  const transport = new StdioClientTransport({
    command: SERVER_CMD,
    args: SERVER_ARGS,
    stderr: "pipe",
  });

  const mcpClient = new Client(
    { name: "agent-eval", version: "1.0.0" },
    { capabilities: {} }
  );

  await mcpClient.connect(transport);
  const tools = await getGatewayTools(mcpClient);
  console.log(
    `[OK] Connected. ${tools.length} gateway tools available: ${tools.map((t) => t.name).join(", ")}\n`
  );

  const results: AgentResult[] = [];

  for (const task of TASKS) {
    process.stdout.write(`  ${task.name.padEnd(35)}`);
    const result = await runAgentTask(genai, mcpClient, tools, task);
    results.push(result);

    const score = Math.round(result.matchScore * 100);
    const icon = score === 100 ? "✓" : score >= 50 ? "~" : "✗";
    const callsSummary = result.toolCalls.map((c) => c.name).join(" → ");
    console.log(
      `${icon} ${score}% match (${result.matched}/${result.totalExpected}) ${result.latencyMs}ms`
    );
    console.log(`    Agent chose: ${callsSummary}`);
    if (result.error) {
      console.log(`    Error: ${result.error.slice(0, 100)}`);
    }
  }

  // ── Summary ──
  const perfectScores = results.filter((r) => r.matchScore === 1).length;
  const avgScore =
    results.reduce((s, r) => s + r.matchScore, 0) / results.length;
  const totalLatency = results.reduce((s, r) => s + r.latencyMs, 0);

  console.log("\n── RESULTS ────────────────────────────────────────────────\n");
  console.log(`  Tasks evaluated:      ${results.length}`);
  console.log(
    `  Perfect match (100%): ${perfectScores}/${results.length}`
  );
  console.log(`  Average match score:  ${Math.round(avgScore * 100)}%`);
  console.log(`  Total latency:        ${totalLatency}ms`);

  // Per-category breakdown
  const fileTasks = results.filter(
    (r) => !r.task.startsWith("DataHub:")
  );
  const dataTasks = results.filter((r) => r.task.startsWith("DataHub:"));
  const fileAvg =
    fileTasks.reduce((s, r) => s + r.matchScore, 0) / fileTasks.length;
  const dataAvg =
    dataTasks.length > 0
      ? dataTasks.reduce((s, r) => s + r.matchScore, 0) / dataTasks.length
      : 0;

  console.log(`\n  File/ops tasks:       ${Math.round(fileAvg * 100)}% avg (${fileTasks.length} tasks)`);
  console.log(
    `  DataHub tasks:        ${Math.round(dataAvg * 100)}% avg (${dataTasks.length} tasks)`
  );

  console.log(
    "\n── CONCLUSION ─────────────────────────────────────────────\n"
  );
  if (perfectScores === results.length) {
    console.log("  ✓ Live agent picks the SAME tools via compact signatures");
    console.log("    as it would with full schemas. The proxy works.");
  } else if (avgScore >= 0.8) {
    console.log("  ~ Live agent mostly agrees, but made some different choices.");
    console.log("    Some compact signatures may be ambiguous or the agent");
    console.log("    found alternative paths that also work.");
  } else {
    console.log("  ✗ Live agent frequently picks different tools than expected.");
    console.log("    Compact signatures may be losing critical information.");
  }

  // ── Detailed results ──
  console.log(
    "\n── DETAILED RESULTS ──────────────────────────────────────\n"
  );
  for (const r of results) {
    const expected = TASKS.find((t) => t.name === r.task)
      ?.expectedSequence.map((e) => e.tool)
      .join(" → ");
    console.log(`  ${r.task}:`);
    console.log(`    Expected: ${expected}`);
    console.log(
      `    Got:      ${r.toolCalls.map((c) => c.name).join(" → ")}`
    );
    if (r.error) console.log(`    Error:    ${r.error.slice(0, 80)}`);
    console.log();
  }

  console.log(
    "══════════════════════════════════════════════════════════════"
  );

  await transport.close();
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
