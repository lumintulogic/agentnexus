export type AuthMode = "none" | "oauth" | "bearer";
export type ServerStatus = "available" | "installed" | "active";

export interface MarketplaceServer {
  id: string;
  name: string;
  vendor: string;
  category: string;
  transport: "HTTP/SSE" | "WebSocket" | "Local bridge";
  authMode: AuthMode;
  status: ServerStatus;
  endpoint: string;
  description: string;
  tools: string[];
}

export const marketplaceServers: MarketplaceServer[] = [
  {
    id: "github",
    name: "GitHub Workspace",
    vendor: "GitHub",
    category: "Developer tools",
    transport: "HTTP/SSE",
    authMode: "oauth",
    status: "active",
    endpoint: "https://mcp.agentnexus.dev/github",
    description: "Repository search, issue triage, pull request summaries, and release automation.",
    tools: ["search_repositories", "summarize_pull_request", "create_issue"]
  },
  {
    id: "google-drive",
    name: "Google Drive",
    vendor: "Google Workspace",
    category: "Productivity",
    transport: "HTTP/SSE",
    authMode: "oauth",
    status: "installed",
    endpoint: "https://mcp.agentnexus.dev/google-drive",
    description: "File discovery, document extraction, folder organization, and permission checks.",
    tools: ["list_files", "extract_document", "update_permissions"]
  },
  {
    id: "postgres",
    name: "Postgres Tools",
    vendor: "AgentNexus Labs",
    category: "Database",
    transport: "WebSocket",
    authMode: "bearer",
    status: "available",
    endpoint: "ws://localhost:8787/mcp/postgres",
    description: "Schema introspection, safe read queries, explain plans, and migration previews.",
    tools: ["inspect_schema", "run_read_query", "explain_query"]
  },
  {
    id: "browser",
    name: "Browser Actions",
    vendor: "Community",
    category: "Automation",
    transport: "Local bridge",
    authMode: "none",
    status: "available",
    endpoint: "ws://localhost:8787/mcp/browser",
    description: "Page navigation, DOM extraction, screenshots, and structured web task execution.",
    tools: ["open_page", "extract_content", "capture_screenshot"]
  }
];

export const modelProviders = ["OpenAI", "Anthropic", "Ollama", "Custom"];
