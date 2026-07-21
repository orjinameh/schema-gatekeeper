/**
 * Live Agent Evaluation — runs real Claude against the gatekeeper MCP tools.
 *
 * This is the actual test: does a live LLM, given only the 3 gateway tools
 * (request_skills, invoke_skill, search_tools), make the same tool choices
 * as a model with full schemas? Or do compact signatures confuse it?
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... node --import tsx/esm src/agent-eval.ts
 *
 * Requires: @anthropic-ai/sdk (npm install @anthropic-ai/sdk)
 */

import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";

const SERVER_CMD = process.execPath;
const SERVER_ARGS = ["--import", "tsx/esm", new URL("./index.ts", import.meta.url).pathname];

// ─── Task Definitions ───────────────────────────────────────────────────────

interface AgentTask {
  name: string;
  prompt: string;
  /** What the agent SHOULD call, in order. Evaluated greedily. */
  expectedSequence: Array<{ tool: string; argsContains?: string }>;
}

const TASKS: AgentTask[] = [
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
    prompt: "I need to find out what operating system this is. Can you check?",
    expectedSequence: [
      { tool: "search_tools", argsContains: "system" },
      { tool: "invoke_skill", argsContains: "get_environment" },
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
  matchScore: number;    // 0-1, how many expected calls matched
  totalExpected: number;
  matched: number;
  latencyMs: number;
  error?: string;
}

/**
 * Get tool definitions from the gatekeeper MCP server.
 */
async function getGatewayTools(
  client: Client
): Promise<Array<{ name: string; description: string; input_schema: Record<string, unknown> }>> {
  const { tools } = await client.listTools();
  return tools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    input_schema: (t as unknown as { inputSchema: Record<string, unknown> }).inputSchema,
  }));
}

/**
 * Execute a tool call through the MCP server and return the result text.
 */
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
 * Run a single task through the live agent.
 */
async function runAgentTask(
  anthropic: Anthropic,
  mcpClient: Client,
  tools: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>,
  task: AgentTask
): Promise<AgentResult> {
  const start = Date.now();
  const toolCalls: ToolCall[] = [];
  const messages: Array<{ role: "user" | "assistant"; content: string | Array<unknown> }> = [
    { role: "user", content: task.prompt },
  ];

  // Allow up to 10 rounds of tool calls (agent can chain multiple)
  for (let round = 0; round < 10; round++) {
    try {
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        tools: tools,
        messages,
      });

      // Check if agent wants to use tools
      const toolBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );

      if (toolBlocks.length === 0) {
        // Agent is done — no more tool calls
        const textBlocks = response.content.filter(
          (b): b is Anthropic.TextBlock => b.type === "text"
        );
        const responseText = textBlocks.map((b) => b.text).join("");

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

      // Execute each tool call through MCP and collect results
      const toolResults: Array<Anthropic.ToolResultBlockParam> = [];

      for (const block of toolBlocks) {
        toolCalls.push({ name: block.name, args: block.input as Record<string, unknown> });
        const resultText = await executeTool(mcpClient, block.name, block.input as Record<string, unknown>);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: resultText,
        });
      }

      // Add assistant message and tool results to conversation
      messages.push({ role: "assistant", content: response.content as unknown as string });
      messages.push({ role: "user", content: toolResults as unknown as string });

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

  // Shouldn't reach here, but handle it
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

/**
 * Greedy match: for each expected call, find the first unmatched agent call that matches.
 */
function countMatched(agentCalls: ToolCall[], task: AgentTask): number {
  const used = new Set<number>();
  let matched = 0;

  for (const expected of task.expectedSequence) {
    for (let i = 0; i < agentCalls.length; i++) {
      if (used.has(i)) continue;
      const call = agentCalls[i];
      if (call.name !== expected.tool) continue;
      if (expected.argsContains && !JSON.stringify(call.args).includes(expected.argsContains)) continue;
      used.add(i);
      matched++;
      break;
    }
  }

  return matched;
}

function computeMatch(agentCalls: ToolCall[], task: AgentTask): number {
  const matched = countMatched(agentCalls, task);
  return task.expectedSequence.length > 0 ? matched / task.expectedSequence.length : 1;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("Error: ANTHROPIC_API_KEY not set.");
    console.error("Usage: ANTHROPIC_API_KEY=sk-... node --import tsx/esm src/agent-eval.ts");
    process.exit(1);
  }

  const anthropic = new Anthropic({ apiKey });

  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║     SCHEMA GATEKEEPER — Live Agent Evaluation              ║");
  console.log("║     (Claude Sonnet 4 vs gateway tools only)                ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

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
  console.log(`[OK] Connected. ${tools.length} gateway tools available: ${tools.map((t) => t.name).join(", ")}\n`);

  const results: AgentResult[] = [];

  for (const task of TASKS) {
    process.stdout.write(`  ${task.name.padEnd(30)}`);
    const result = await runAgentTask(anthropic, mcpClient, tools, task);
    results.push(result);

    const score = Math.round(result.matchScore * 100);
    const icon = score === 100 ? "✓" : score >= 50 ? "~" : "✗";
    const callsSummary = result.toolCalls.map((c) => c.name).join(" → ");
    console.log(`${icon} ${score}% match (${result.matched}/${result.totalExpected}) ${result.latencyMs}ms`);
    console.log(`    Agent chose: ${callsSummary}`);
  }

  // ── Summary ──
  const perfectScores = results.filter((r) => r.matchScore === 1).length;
  const avgScore = results.reduce((s, r) => s + r.matchScore, 0) / results.length;
  const totalLatency = results.reduce((s, r) => s + r.latencyMs, 0);

  console.log("\n── RESULTS ────────────────────────────────────────────────\n");
  console.log(`  Tasks evaluated:      ${results.length}`);
  console.log(`  Perfect match (100%): ${perfectScores}/${results.length}`);
  console.log(`  Average match score:  ${Math.round(avgScore * 100)}%`);
  console.log(`  Total latency:        ${totalLatency}ms`);

  console.log("\n── CONCLUSION ─────────────────────────────────────────────\n");
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
  console.log("\n── DETAILED RESULTS ──────────────────────────────────────\n");
  for (const r of results) {
    const expected = r.task
      ? TASKS.find((t) => t.name === r.task)?.expectedSequence.map((e) => e.tool).join(" → ")
      : "";
    console.log(`  ${r.task}:`);
    console.log(`    Expected: ${expected}`);
    console.log(`    Got:      ${r.toolCalls.map((c) => c.name).join(" → ")}`);
    if (r.error) console.log(`    Error:    ${r.error}`);
    console.log();
  }

  console.log("══════════════════════════════════════════════════════════════");

  await transport.close();
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
