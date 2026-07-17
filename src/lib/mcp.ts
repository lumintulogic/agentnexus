import type { MarketplaceServer } from "@/data/registry";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

export interface CapabilityHandshake {
  serverId: string;
  endpoint: string;
  tools: ToolDefinition[];
  promptFragment: string;
}

export function createMockCapabilityHandshake(server: MarketplaceServer): CapabilityHandshake {
  const tools = server.tools.map((tool) => ({
    name: tool,
    description: `${server.name} capability exposed through the AgentNexus MCP bridge.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Natural language instruction or lookup term."
        }
      },
      required: ["query"]
    }
  }));

  return {
    serverId: server.id,
    endpoint: server.endpoint,
    tools,
    promptFragment: `Use ${server.name} for ${server.category.toLowerCase()} tasks. Available tools: ${tools
      .map((tool) => tool.name)
      .join(", ")}.`
  };
}
