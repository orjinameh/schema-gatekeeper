/**
 * Benchmark harness — runs metrics simulation and outputs chart data + summary.
 * Usage: node --import tsx/esm src/benchmark.ts
 */

import { generateBenchmarkSummary } from "./metrics.js";
import fs from "fs";
import { fileURLToPath } from "url";

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function printBar(label: string, value: number, maxValue: number, width = 40): string {
  const filled = Math.round((value / maxValue) * width);
  const bar = "█".repeat(filled) + "░".repeat(width - filled);
  return `  ${label.padEnd(22)} ${bar} ${formatNumber(value)} tokens`;
}

function main() {
  const s = generateBenchmarkSummary();

  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║     ON-DEMAND SCHEMA GATEKEEPER — Benchmark Results        ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  // ── Upfront Cost ──
  console.log("── UPFRONT TOOL LOADING (tools/list) ──────────────────────\n");
  const maxUpfront = Math.max(s.rawTotalTokens, s.masterToolTokens) * 1.1;
  console.log(printBar("Without proxy", s.rawTotalTokens, maxUpfront));
  console.log(printBar("With proxy", s.masterToolTokens, maxUpfront));
  console.log(`\n  ✦ Savings: ${s.upfrontSavingsPercent}% fewer tokens\n`);

  // ── Conversation Turn-by-Turn ──
  console.log("── TOKEN USAGE BY CONVERSATION TURN ───────────────────────\n");
  const maxTokens = Math.max(...s.turnSnapshots.map((t) => Math.max(t.rawTokens, t.proxyTokens)));

  console.log(`  ${"Turn".padEnd(6)} ${"Description".padEnd(30)} ${"Raw".padStart(12)} ${"Proxy".padStart(12)} ${"Δ".padStart(10)}`);
  console.log(`  ${"─".repeat(6)} ${"─".repeat(30)} ${"─".repeat(12)} ${"─".repeat(12)} ${"─".repeat(10)}`);

  for (const t of s.turnSnapshots) {
    const delta = t.rawTokens - t.proxyTokens;
    const pct = s.turnSnapshots[0].rawTokens === t.rawTokens ? 0 : Math.round((delta / t.rawTokens) * 100);
    console.log(
      `  ${String(t.turn).padEnd(6)} ${t.description.padEnd(30)} ${formatNumber(t.rawTokens).padStart(12)} ${formatNumber(t.proxyTokens).padStart(12)} ${("−" + formatNumber(delta)).padStart(10)}`
    );
  }

  const finalDelta = s.finalRawTokens - s.finalProxyTokens;
  console.log(`\n  ✦ Final conversation savings: ${s.conversationSavingsPercent}% (${formatNumber(finalDelta)} fewer tokens)\n`);

  // ── Visual Bar Chart (tokens per turn) ──
  console.log("── TOKENS PER TURN (visual) ───────────────────────────────\n");
  for (const t of s.turnSnapshots) {
    const rawBar = "█".repeat(Math.round((t.rawTokens / maxTokens) * 35));
    const proxyBar = "▓".repeat(Math.round((t.proxyTokens / maxTokens) * 35));
    console.log(`  Turn ${t.turn}`);
    console.log(`    Raw:   ${rawBar} ${formatNumber(t.rawTokens)}`);
    console.log(`    Proxy: ${proxyBar} ${formatNumber(t.proxyTokens)}`);
  }

  // ── Tools in Context ──
  console.log("\n── TOOLS IN LLM CONTEXT ───────────────────────────────────\n");
  console.log(`  Without proxy: ${s.peakRawToolsInContext} full JSON schemas`);
  console.log(`  With proxy:    ${s.peakProxyToolsInContext} compact pseudo-signatures (loaded on demand)`);
  console.log(`  Context savings: ${Math.round(((s.peakRawToolsInContext - s.peakProxyToolsInContext) / s.peakRawToolsInContext) * 100)}% fewer tool definitions\n`);

  // ── Summary ──
  console.log("── SUMMARY ────────────────────────────────────────────────\n");
  console.log(`  Total tools registered:  ${s.totalTools}`);
  console.log(`  Categories:              ${s.categories}`);
  console.log(`  Conversation turns:      ${s.conversationTurns}`);
  console.log(`  Upfront token savings:   ${s.upfrontSavingsPercent}%`);
  console.log(`  Conversation savings:    ${s.conversationSavingsPercent}%`);
  console.log(`  Final tokens (raw):      ${formatNumber(s.finalRawTokens)}`);
  console.log(`  Final tokens (proxy):    ${formatNumber(s.finalProxyTokens)}`);

  // ── Latency Tradeoff ──
  console.log("\n── LATENCY TRADEOFF ───────────────────────────────────────\n");
  console.log(`  Tool calls (raw path):     ${s.totalRawToolCalls} calls`);
  console.log(`  Tool calls (proxy path):   ${s.totalProxyToolCalls} calls (+${s.totalProxyToolCalls - s.totalRawToolCalls} discovery round-trips)`);
  console.log(`  Estimated latency (raw):   ~${s.estimatedRawLatencyMs}ms`);
  console.log(`  Estimated latency (proxy): ~${s.estimatedProxyLatencyMs}ms`);
  console.log(`  Latency overhead:          +${s.estimatedProxyLatencyMs - s.estimatedRawLatencyMs}ms per conversation`);
  console.log(`  Note: 1 extra round-trip per tool use for category discovery.`);
  console.log(`  For simple one-shot tasks, this is a net latency cost.`);
  console.log(`  For multi-turn conversations with many tools, token savings dominate.`);

  // ── JSON export for charting ──
  const chartData = {
    labels: s.turnSnapshots.map((t) => `Turn ${t.turn}`),
    raw: s.turnSnapshots.map((t) => t.rawTokens),
    proxy: s.turnSnapshots.map((t) => t.proxyTokens),
    descriptions: s.turnSnapshots.map((t) => t.description),
    rawToolCalls: s.turnSnapshots.map((t) => t.rawToolCalls),
    proxyToolCalls: s.turnSnapshots.map((t) => t.proxyToolCalls),
    summary: {
      upfrontSavings: s.upfrontSavingsPercent,
      conversationSavings: s.conversationSavingsPercent,
      totalTools: s.totalTools,
      categories: s.categories,
      totalRawToolCalls: s.totalRawToolCalls,
      totalProxyToolCalls: s.totalProxyToolCalls,
      estimatedRawLatencyMs: s.estimatedRawLatencyMs,
      estimatedProxyLatencyMs: s.estimatedProxyLatencyMs,
    },
  };

  const __dirname = fileURLToPath(new URL(".", import.meta.url));
  fs.writeFileSync(
    __dirname + "../demo/chart-data.json",
    JSON.stringify(chartData, null, 2)
  );
  console.log("\n── Chart data exported to demo/chart-data.json ─────────────\n");
}

main();
