/**
 * Metrics — token counting and savings measurement.
 *
 * Uses a GPT-4/Cl100k-compatible rough estimator.
 * For hackathon purposes, 1 token ≈ 4 chars is accurate enough.
 * For the demo chart, we'll also count "tool definitions loaded" as a metric.
 */

import { REGISTRY, CATEGORIES } from "./registry.js";
import { compactTools, renderCatalog } from "./compactor.js";

// ─── Token Estimation ────────────────────────────────────────────────────────

/** Rough token count: ~4 chars per token for English text + JSON. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Token count for a raw JSON schema dump of a tool. */
function rawToolTokens(tool: (typeof REGISTRY)[number]): number {
  const schemaStr = JSON.stringify(tool.inputSchema);
  const descStr = tool.description;
  return estimateTokens(`Tool: ${tool.name}\nDescription: ${descStr}\nSchema: ${schemaStr}`);
}

/** Total tokens if all tools were loaded raw (no proxy). */
export function totalRawTokens(): number {
  return REGISTRY.reduce((sum, t) => sum + rawToolTokens(t), 0);
}

/** Tokens for the 3 master tool definitions (request_skills + invoke_skill + search_tools). */
export function masterToolTokens(): number {
  const requestSkillsDesc =
    "Discover available tools by category. Returns compact signatures — call this before invoke_skill. Categories: " +
    CATEGORIES.join(", ");
  const invokeSkillDesc =
    "Execute a tool by name with the given arguments. Use request_skills first to discover available tools and their signatures.";
  const searchToolsDesc =
    "Search available tools by free-text query. Use when request_skills categories don't cover what you need, or you're unsure which category a tool belongs to.";

  return (
    estimateTokens(`Tool: request_skills\nDescription: ${requestSkillsDesc}\nSchema: {"type":"object","properties":{"category":{"type":"string","enum":[${CATEGORIES.map((c) => `"${c}"`).join(",")}]}}}`) +
    estimateTokens(`Tool: invoke_skill\nDescription: ${invokeSkillDesc}\nSchema: {"type":"object","properties":{"toolName":{"type":"string"},"payload":{"type":"object"}}}`) +
    estimateTokens(`Tool: search_tools\nDescription: ${searchToolsDesc}\nSchema: {"type":"object","properties":{"query":{"type":"string"},"maxResults":{"type":"number"}}}`)
  );
}

/** Tokens for a compact catalog of N tools in one category. */
export function catalogTokensForCategory(category: string): number {
  const tools = REGISTRY.filter((t) => t.category === category);
  const compacted = compactTools(tools);
  const catalog = renderCatalog(compacted);
  return estimateTokens(catalog);
}

// ─── Turn-by-Turn Simulation ─────────────────────────────────────────────────

export interface TurnSnapshot {
  turn: number;
  description: string;
  rawTokens: number;      // cumulative tokens WITHOUT proxy
  proxyTokens: number;    // cumulative tokens WITH proxy
  rawToolsLoaded: number; // total tool schemas in context
  proxyToolsLoaded: number; // compact signatures in context
  rawToolCalls: number;   // number of tool invocations (latency proxy)
  proxyToolCalls: number; // tool invocations through proxy (includes discovery)
}

/**
 * Simulate a realistic 5-turn conversation and track token usage.
 *
 * Turn 1: LLM discovers what tools exist
 * Turn 2: LLM requests file-operations category
 * Turn 3: LLM reads a file via invoke_skill
 * Turn 4: LLM requests database category
 * Turn 5: LLM queries a database via invoke_skill
 */
export function simulateConversation(): TurnSnapshot[] {
  const snapshots: TurnSnapshot[] = [];
  let rawCumulative = 0;
  let proxyCumulative = 0;
  let rawToolsInContext = 0;

  // ── Turn 0: System prompt (same for both) ──
  const systemPrompt =
    "You are a helpful assistant with access to various tools. Use the tools when needed.";
  const systemTokens = estimateTokens(systemPrompt);
  rawCumulative += systemTokens;
  proxyCumulative += systemTokens;

  let rawToolCalls = 0;
  let proxyToolCalls = 0;

  // ── Turn 1: tools/list ──
  // WITHOUT proxy: LLM receives all 16 tool schemas
  const allRawTokens = totalRawTokens();
  rawCumulative += allRawTokens;
  rawToolsInContext = REGISTRY.length;

  // WITH proxy: LLM receives 3 master tool schemas
  const masterTokens = masterToolTokens();
  proxyCumulative += masterTokens;
  let proxyToolsInContext = 3;

  snapshots.push({
    turn: 1,
    description: "System loads tools (tools/list)",
    rawTokens: rawCumulative,
    proxyTokens: proxyCumulative,
    rawToolsLoaded: rawToolsInContext,
    proxyToolsLoaded: proxyToolsInContext,
    rawToolCalls,
    proxyToolCalls,
  });

  // ── Turn 2: User asks "read my test file" ──
  const userMsg2 = estimateTokens("Read the file /tmp/gatekeeper-test.txt");
  rawCumulative += userMsg2;
  proxyCumulative += userMsg2;

  // WITHOUT proxy: LLM sees all 16 schemas again in context (they persist)
  // No additional tool loading — schemas are already in context
  rawCumulative += estimateTokens(
    "Assistant: I'll use the read_file tool to read the file."
  );
  proxyCumulative += estimateTokens(
    "Assistant: I'll use request_skills to find file tools, then invoke_skill to read."
  );

  snapshots.push({
    turn: 2,
    description: "User: 'Read my test file'",
    rawTokens: rawCumulative,
    proxyTokens: proxyCumulative,
    rawToolsLoaded: rawToolsInContext,
    proxyToolsLoaded: proxyToolsInContext,
    rawToolCalls,
    proxyToolCalls,
  });

  // ── Turn 3: LLM calls read_file (or request_skills + invoke_skill) ──
  // WITHOUT proxy: LLM calls read_file directly. Tool call + response tokens.
  const toolCallTokens = estimateTokens(
    JSON.stringify({ name: "read_file", arguments: { path: "/tmp/gatekeeper-test.txt" } })
  );
  const toolResultTokens = estimateTokens(
    '{"content":[{"type":"text","text":"Hello from Schema Gatekeeper proxy test!\\n"}]}'
  );
  rawCumulative += toolCallTokens + toolResultTokens;
  rawToolCalls += 1;

  // WITH proxy: LLM calls request_skills → gets catalog → calls invoke_skill
  const requestSkillsCall = estimateTokens(
    JSON.stringify({ name: "request_skills", arguments: { category: "file-operations" } })
  );
  const fileCatalog = catalogTokensForCategory("file-operations");
  const invokeSkillCall = estimateTokens(
    JSON.stringify({ name: "invoke_skill", arguments: { toolName: "read_file", payload: { path: "/tmp/gatekeeper-test.txt" } } })
  );
  proxyCumulative += requestSkillsCall + fileCatalog + invokeSkillCall + toolResultTokens;
  proxyToolCalls += 2; // request_skills + invoke_skill

  // Proxy adds 4 compact signatures to context for next turns
  proxyToolsInContext += 4; // 4 file-operations tools

  snapshots.push({
    turn: 3,
    description: "Tool execution: read_file",
    rawTokens: rawCumulative,
    proxyTokens: proxyCumulative,
    rawToolsLoaded: rawToolsInContext,
    proxyToolsLoaded: proxyToolsInContext,
    rawToolCalls,
    proxyToolCalls,
  });

  // ── Turn 4: User asks "query my database" ──
  const userMsg4 = estimateTokens("Run a SQL query to list all users");
  rawCumulative += userMsg4;
  proxyCumulative += userMsg4;

  rawCumulative += estimateTokens(
    "Assistant: I'll use the query tool to run the SQL."
  );
  proxyCumulative += estimateTokens(
    "Assistant: I'll use request_skills to find database tools."
  );

  snapshots.push({
    turn: 4,
    description: "User: 'Query my database'",
    rawTokens: rawCumulative,
    proxyTokens: proxyCumulative,
    rawToolsLoaded: rawToolsInContext,
    proxyToolsLoaded: proxyToolsInContext,
    rawToolCalls,
    proxyToolCalls,
  });

  // ── Turn 5: LLM calls query (or request_skills + invoke_skill) ──
  rawCumulative += estimateTokens(
    JSON.stringify({ name: "query", arguments: { sql: "SELECT * FROM users" } })
  ) + toolResultTokens;
  rawToolCalls += 1;

  const dbCatalog = catalogTokensForCategory("database");
  proxyCumulative += requestSkillsCall + dbCatalog + invokeSkillCall + toolResultTokens;
  proxyToolCalls += 2;

  proxyToolsInContext += 2; // 2 database tools

  snapshots.push({
    turn: 5,
    description: "Tool execution: query",
    rawTokens: rawCumulative,
    proxyTokens: proxyCumulative,
    rawToolsLoaded: rawToolsInContext,
    proxyToolsLoaded: proxyToolsInContext,
    rawToolCalls,
    proxyToolCalls,
  });

  return snapshots;
}

// ─── Summary Stats ───────────────────────────────────────────────────────────

export interface BenchmarkSummary {
  totalTools: number;
  categories: number;
  rawTotalTokens: number;
  masterToolTokens: number;
  upfrontSavingsPercent: number;
  conversationTurns: number;
  finalRawTokens: number;
  finalProxyTokens: number;
  conversationSavingsPercent: number;
  peakRawToolsInContext: number;
  peakProxyToolsInContext: number;
  totalRawToolCalls: number;
  totalProxyToolCalls: number;
  estimatedRawLatencyMs: number;
  estimatedProxyLatencyMs: number;
  turnSnapshots: TurnSnapshot[];
}

export function generateBenchmarkSummary(): BenchmarkSummary {
  const snapshots = simulateConversation();
  const last = snapshots[snapshots.length - 1];

  const rawTotal = totalRawTokens();
  const masterTokens = masterToolTokens();

  const totalRawCalls = last.rawToolCalls;
  const totalProxyCalls = last.proxyToolCalls;

  // Latency estimate: ~200ms per tool call (LLM inference + network round-trip)
  // Proxy adds 1 extra call per tool use (discovery step)
  const LATENCY_PER_CALL_MS = 200;

  return {
    totalTools: REGISTRY.length,
    categories: CATEGORIES.length,
    rawTotalTokens: rawTotal,
    masterToolTokens: masterTokens,
    upfrontSavingsPercent: Math.round(
      ((rawTotal - masterTokens) / rawTotal) * 100
    ),
    conversationTurns: snapshots.length,
    finalRawTokens: last.rawTokens,
    finalProxyTokens: last.proxyTokens,
    conversationSavingsPercent: Math.round(
      ((last.rawTokens - last.proxyTokens) / last.rawTokens) * 100
    ),
    peakRawToolsInContext: last.rawToolsLoaded,
    peakProxyToolsInContext: last.proxyToolsLoaded,
    totalRawToolCalls: totalRawCalls,
    totalProxyToolCalls: totalProxyCalls,
    estimatedRawLatencyMs: totalRawCalls * LATENCY_PER_CALL_MS,
    estimatedProxyLatencyMs: totalProxyCalls * LATENCY_PER_CALL_MS,
    turnSnapshots: snapshots,
  };
}
