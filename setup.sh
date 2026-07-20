#!/bin/bash
# Quick setup for Schema Gatekeeper
set -e

echo "=== On-Demand Schema Gatekeeper Setup ==="

# Install deps
npm install

# Create test file
mkdir -p /tmp
echo "Hello from Schema Gatekeeper!" > /tmp/gatekeeper-test.txt

# Detect which client to configure
CLAUDE_CONFIG=""
if command -v claude &> /dev/null; then
  CLAUDE_CONFIG="claude-code"
fi
if [ -f "$HOME/.config/Claude/claude_desktop_config.json" ]; then
  CLAUDE_CONFIG="claude-desktop"
fi

# Write project-level MCP config (works with both)
cat > .mcp.json << 'EOF'
{
  "mcpServers": {
    "gatekeeper": {
      "command": "node",
      "args": ["--import", "tsx/esm", "src/index.ts"]
    }
  }
}
EOF

echo ""
echo "Setup complete! Next steps:"
echo ""
echo "  Run the server:    node --import tsx/esm src/index.ts"
echo "  Run tests:         node --import tsx/esm src/test.ts"
echo "  Run benchmark:     node --import tsx/esm src/benchmark.ts"
echo "  Open chart:        open demo/chart.html"
echo ""

if [ "$CLAUDE_CONFIG" = "claude-code" ]; then
  echo "Claude Code detected. Run 'claude' in this directory to use the server."
elif [ "$CLAUDE_CONFIG" = "claude-desktop" ]; then
  echo "Claude Desktop detected. Add to ~/.config/Claude/claude_desktop_config.json:"
  echo '  "gatekeeper": { "command": "node", "args": ["--import", "tsx/esm", "src/index.ts"] }'
else
  echo "To use with Claude Code: run 'claude' in this directory"
  echo "To use with Claude Desktop: add MCP config to ~/.config/Claude/claude_desktop_config.json"
fi
