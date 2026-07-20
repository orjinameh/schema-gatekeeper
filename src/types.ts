export interface ToolSchema {
  name: string;
  category: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface CompactedTool {
  name: string;
  signature: string;
  category: string;
}

export interface GatekeeperMetrics {
  toolsRegistered: number;
  tokensSavedPerRequest: number;
  requestsHandled: number;
}
