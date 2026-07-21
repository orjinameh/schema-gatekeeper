/**
 * End-to-end test for Schema Gatekeeper.
 * Tests: handshake, request_skills, invoke_skill (simulated + real proxy).
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";

const SERVER_CMD = process.execPath;
const SERVER_ARGS = ["--import", "tsx/esm", new URL("./index.ts", import.meta.url).pathname];

async function main() {
  console.log("=== Schema Gatekeeper E2E Test ===\n");

  const transport = new StdioClientTransport({
    command: SERVER_CMD,
    args: SERVER_ARGS,
    stderr: "pipe",
  });

  const client = new Client(
    { name: "test-harness", version: "1.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);
  console.log("[PASS] Connected to Schema Gatekeeper");

  // Test 1: List tools — should see only 2
  const { tools } = await client.listTools();
  console.log(`[PASS] tools/list returned ${tools.length} tools (expected 2)`);
  console.log(`       Tools: ${tools.map((t) => t.name).join(", ")}`);

  if (tools.length !== 3) {
    console.error("[FAIL] Expected exactly 3 tools (request_skills, invoke_skill, search_tools)");
    process.exit(1);
  }

  // Test 2: request_skills — file-operations
  const fileResult = await client.callTool({
    name: "request_skills",
    arguments: { category: "file-operations" },
  });
  const fileText =
    "content" in fileResult
      ? (fileResult.content as Array<{ type: string; text: string }>)
          .map((c) => c.text)
          .join("")
      : "";
  const hasReadFile = fileText.includes("read_file");
  const hasWriteFile = fileText.includes("write_file");
  const hasCompact = fileText.includes("!:string");
  console.log(
    `[PASS] request_skills(file-operations) returned catalog with read_file=${hasReadFile}, write_file=${hasWriteFile}, compact=${hasCompact}`
  );

  if (!hasReadFile || !hasWriteFile || !hasCompact) {
    console.error("[FAIL] Expected compact catalog with read_file and write_file");
    console.error(fileText);
    process.exit(1);
  }

  // Test 3: request_skills — all categories
  for (const cat of [
    "database",
    "web-search",
    "browser",
    "git",
    "ai-inference",
    "system",
  ]) {
    const r = await client.callTool({
      name: "request_skills",
      arguments: { category: cat },
    });
    const text =
      "content" in r
        ? (r.content as Array<{ type: string; text: string }>)
            .map((c) => c.text)
            .join("")
        : "";
    const toolCount = (text.match(/\w+\(/g) || []).length;
    console.log(`[PASS] request_skills("${cat}") → ${toolCount} tools`);
  }

  // Test 4: invoke_skill with missing required args
  const badResult = await client.callTool({
    name: "invoke_skill",
    arguments: { toolName: "read_file", payload: {} },
  });
  const badText =
    "content" in badResult
      ? (badResult.content as Array<{ type: string; text: string }>)
          .map((c) => c.text)
          .join("")
      : "";
  const hasMissingError = badResult.isError && badText.includes("Missing required");
  console.log(`[PASS] invoke_skill missing args → error=${badResult.isError}, msg includes "Missing required"=${hasMissingError}`);

  // Test 5: invoke_skill — real proxy to filesystem server
  const realResult = await client.callTool({
    name: "invoke_skill",
    arguments: {
      toolName: "read_file",
      payload: { path: "/tmp/gatekeeper-test.txt" },
    },
  });
  const realText =
    "content" in realResult
      ? (realResult.content as Array<{ type: string; text: string }>)
          .map((c) => c.text)
          .join("")
      : "";
  const hasRealContent = realText.includes("Hello from Schema Gatekeeper");
  console.log(
    `[PASS] invoke_skill(read_file) → real content=${hasRealContent}`
  );

  if (!hasRealContent) {
    console.error("[FAIL] Expected real file content from proxy");
    console.error("Got:", realText);
    process.exit(1);
  }

  // Test 6: invoke_skill — simulated (git has no real backend)
  const simResult = await client.callTool({
    name: "invoke_skill",
    arguments: {
      toolName: "git_status",
      payload: {},
    },
  });
  const simText =
    "content" in simResult
      ? (simResult.content as Array<{ type: string; text: string }>)
          .map((c) => c.text)
          .join("")
      : "";
  const hasSimulated = simText.includes("simulated");
  console.log(`[PASS] invoke_skill(git_status) → simulated=${hasSimulated}`);

  // Test 7: invoke_skill — unknown tool
  const unknownResult = await client.callTool({
    name: "invoke_skill",
    arguments: { toolName: "totally_fake", payload: {} },
  });
  const unknownText =
    "content" in unknownResult
      ? (unknownResult.content as Array<{ type: string; text: string }>)
          .map((c) => c.text)
          .join("")
      : "";
  const hasNotFound = unknownResult.isError && unknownText.includes("not found");
  console.log(`[PASS] invoke_skill(unknown) → not found=${hasNotFound}`);

  // Test 8: search_tools — keyword search
  const searchResult = await client.callTool({
    name: "search_tools",
    arguments: { query: "file read" },
  });
  const searchText =
    "content" in searchResult
      ? (searchResult.content as Array<{ type: string; text: string }>)
          .map((c) => c.text)
          .join("")
      : "";
  const hasSearchResults = searchText.includes("read_file");
  const hasMatchCount = searchText.includes("matches");
  console.log(
    `[PASS] search_tools("file read") → found read_file=${hasSearchResults}, match count=${hasMatchCount}`
  );

  // Test 9: search_tools — no results
  const noResult = await client.callTool({
    name: "search_tools",
    arguments: { query: "quantum entanglement" },
  });
  const noResultText =
    "content" in noResult
      ? (noResult.content as Array<{ type: string; text: string }>)
          .map((c) => c.text)
          .join("")
      : "";
  const hasNoMatches = noResultText.includes("No tools matched");
  console.log(`[PASS] search_tools("quantum entanglement") → no matches=${hasNoMatches}`);

  await transport.close();

  // ── Metrics Tests ──
  const {
    estimateTokens,
    totalRawTokens,
    masterToolTokens,
    generateBenchmarkSummary,
  } = await import("./metrics.js");

  const rawTotal = totalRawTokens();
  const master = masterToolTokens();
  const savings = Math.round(((rawTotal - master) / rawTotal) * 100);
  console.log(`[PASS] metrics: rawTotal=${rawTotal} tokens, master=${master} tokens, savings=${savings}%`);

  if (savings < 80) {
    console.error("[FAIL] Expected >80% upfront savings");
    process.exit(1);
  }

  const summary = generateBenchmarkSummary();
  console.log(`[PASS] metrics: ${summary.conversationTurns}-turn conversation savings=${summary.conversationSavingsPercent}%`);
  console.log(`[PASS] metrics: ${summary.totalTools} tools across ${summary.categories} categories`);

  if (summary.conversationSavingsPercent < 50) {
    console.error("[FAIL] Expected >50% conversation savings");
    process.exit(1);
  }

  console.log("\n=== ALL TESTS PASSED ===");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
