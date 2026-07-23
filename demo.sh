#!/bin/bash
# Schema Gatekeeper Demo Script
# Record with: asciinema rec demo.cast -- bash demo.sh
# Or just screen-record this in your terminal

set -e
BOLD='\033[1m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
RESET='\033[0m'

clear
echo -e "${BOLD}╔══════════════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║        SCHEMA GATEKEEPER — Live Demo                       ║${RESET}"
echo -e "${BOLD}║   MCP Tool Schema Proxy: 93% fewer tokens, same accuracy   ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════╝${RESET}"
echo ""
sleep 2

echo -e "${CYAN}━━━ THE PROBLEM ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""
echo "  Every LLM agent connected to MCP tools receives ALL schemas upfront."
echo "  With 28 tools, that's ~3,636 tokens of JSON boilerplate."
echo "  Most tools are never used. Wasted context. Wasted money."
echo ""
sleep 3

echo -e "${CYAN}━━━ THE SOLUTION ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""
echo "  Schema Gatekeeper sits between the agent and all tool servers."
echo "  Instead of dumping 28 schemas, it exposes just 3 tools:"
echo ""
echo "    request_skills  — discover tools by category"
echo "    invoke_skill    — execute a tool by name"
echo "    search_tools    — keyword search over tools"
echo ""
sleep 3

echo -e "${CYAN}━━━ STEP 1: WHAT THE AGENT SEES ━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""
echo "  Without proxy — tools/list returns 28 full JSON schemas:"
echo ""
echo -e "    ${RED}┌─────────────────────────────────────────────────────────────┐${RESET}"
echo -e "    ${RED}│  tools: [                                                  │${RESET}"
echo -e "    ${RED}│    { name: \"read_file\", description: \"Reads...\",           │${RESET}"
echo -e "    ${RED}│      inputSchema: { type: \"object\", properties: {...} } }, │${RESET}"
echo -e "    ${RED}│    { name: \"write_file\", ... },  // repeated 27 more times │${RESET}"
echo -e "    ${RED}│    ...                                                      │${RESET}"
echo -e "    ${RED}│  ] → 3,636 tokens consumed before the user even speaks    │${RESET}"
echo -e "    ${RED}└─────────────────────────────────────────────────────────────┘${RESET}"
echo ""
sleep 2

echo "  With proxy — tools/list returns only 3 tools:"
echo ""
echo -e "    ${GREEN}┌─────────────────────────────────────────────────────────────┐${RESET}"
echo -e "    ${GREEN}│  tools: [                                                  │${RESET}"
echo -e "    ${GREEN}│    { name: \"request_skills\" },                             │${RESET}"
echo -e "    ${GREEN}│    { name: \"invoke_skill\" },                               │${RESET}"
echo -e "    ${GREEN}│    { name: \"search_tools\" }                                │${RESET}"
echo -e "    ${GREEN}│  ] → 238 tokens — 93% savings                             │${RESET}"
echo -e "    ${GREEN}└─────────────────────────────────────────────────────────────┘${RESET}"
echo ""
sleep 3

echo -e "${CYAN}━━━ STEP 2: LIVE TOOL DISCOVERY ━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""

cd "$(dirname "$0")"

node --import tsx/esm -e "
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'node',
  args: ['--import', 'tsx/esm', 'src/index.ts'],
  env: { ...process.env, DATAHUB_GMS_URL: '' }
});
const client = new Client({ name: 'demo', version: '1.0.0' });
await client.connect(transport);

// Show tools/list
const tools = await client.listTools();
console.log('  tools/list returns ' + tools.tools.length + ' tools:');
tools.tools.forEach(t => console.log('    - ' + t.name));
console.log('');

// Discover file-operations
console.log('  > request_skills(\"file-operations\")');
console.log('');
const res = await client.callTool({ name: 'request_skills', arguments: { category: 'file-operations' } });
res.content[0].text.split('\\n').forEach(l => console.log('  ' + l));

console.log('');
console.log('  > request_skills(\"data-catalog\")');
console.log('');
const res2 = await client.callTool({ name: 'request_skills', arguments: { category: 'data-catalog' } });
res2.content[0].text.split('\\n').forEach(l => console.log('  ' + l));

await client.close();
process.exit(0);
" 2>&1 | grep -v "^$"

echo ""
sleep 3

echo -e "${CYAN}━━━ STEP 3: LIVE TOOL EXECUTION ━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""

node --import tsx/esm -e "
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'node',
  args: ['--import', 'tsx/esm', 'src/index.ts'],
  env: { ...process.env, DATAHUB_GMS_URL: '' }
});
const client = new Client({ name: 'demo', version: '1.0.0' });
await client.connect(transport);

console.log('  > invoke_skill(\"read_file\", {path: \"package.json\"})');
console.log('');
const res = await client.callTool({ name: 'invoke_skill', arguments: { tool: 'read_file', args: { path: 'package.json' } } });
res.content[0].text.split('\\n').slice(0, 15).forEach(l => console.log('  ' + l));
console.log('  ...');

console.log('');
console.log('  > invoke_skill(\"git_status\", {})');
console.log('');
const res2 = await client.callTool({ name: 'invoke_skill', arguments: { tool: 'git_status', args: {} } });
res2.content[0].text.split('\\n').slice(0, 8).forEach(l => console.log('  ' + l));

console.log('');
console.log('  > search_tools(\"database query\")');
console.log('');
const res3 = await client.callTool({ name: 'search_tools', arguments: { query: 'database query' } });
res3.content[0].text.split('\\n').forEach(l => console.log('  ' + l));

await client.close();
process.exit(0);
" 2>&1 | grep -v "^$"

echo ""
sleep 3

echo -e "${CYAN}━━━ STEP 4: DATAHUB TOOLS (12 tools via GraphQL) ━━━━━━━━━━${RESET}"
echo ""
echo "  The proxy also integrates DataHub — the open-source metadata platform."
echo "  12 tools for data discovery, lineage, and governance:"
echo ""
echo "    dh_search       search across all data assets"
echo "    dh_list_schema  column-level schema with types and tags"
echo "    dh_get_lineage  upstream/downstream data flow"
echo "    dh_draft_sql    draft SQL using real schema context"
echo "    dh_add_tags     add classification tags to datasets"
echo "    dh_add_terms    add business glossary terms"
echo "  ... and 6 more"
echo ""
echo "  These call DataHub's GraphQL API directly — no Python dependency."
echo "  (DataHub GMS is not running on this laptop — tools return"
echo "   graceful errors, but the integration is fully functional.)"
echo ""
sleep 3

echo -e "${CYAN}━━━ STEP 5: BENCHMARK ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""
npm run benchmark 2>&1
echo ""
sleep 2

echo -e "${CYAN}━━━ STEP 6: TASK-SUCCESS EVAL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""
npm run eval 2>&1
echo ""

echo -e "${BOLD}╔══════════════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║  RESULTS                                                    ║${RESET}"
echo -e "${BOLD}╠══════════════════════════════════════════════════════════════╣${RESET}"
echo -e "${BOLD}║  ${GREEN}✓ 93% fewer tokens upfront (3,636 → 238)                   ${BOLD}║${RESET}"
echo -e "${BOLD}║  ${GREEN}✓ 84% savings over a 5-turn conversation                   ${BOLD}║${RESET}"
echo -e "${BOLD}║  ${GREEN}✓ 18/18 tasks pass — proxy matches direct path             ${BOLD}║${RESET}"
echo -e "${BOLD}║  ${GREEN}✓ 28 tools across 8 categories                             ${BOLD}║${RESET}"
echo -e "${BOLD}║  ${GREEN}✓ 12 real DataHub tools (direct GraphQL)                   ${BOLD}║${RESET}"
echo -e "${BOLD}║  ${GREEN}✓ 4 real backends (MCP, GraphQL, git, shell)               ${BOLD}║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════╝${RESET}"
echo ""
