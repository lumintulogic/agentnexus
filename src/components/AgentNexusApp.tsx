import {
  Activity,
  Bot,
  Check,
  ChevronsUpDown,
  KeyRound,
  PlugZap,
  Search,
  Send,
  ShieldCheck,
  Store,
  TerminalSquare,
  ToggleLeft,
  ToggleRight
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { marketplaceServers, modelProviders, type MarketplaceServer } from "@/data/registry";
import { createMockCapabilityHandshake } from "@/lib/mcp";
import "./AgentNexusApp.css";

type ServerState = Record<string, MarketplaceServer["status"]>;

const statusLabels: Record<MarketplaceServer["status"], string> = {
  active: "Active",
  installed: "Installed",
  available: "Available"
};

function getNextStatus(status: MarketplaceServer["status"]): MarketplaceServer["status"] {
  if (status === "available") return "installed";
  if (status === "installed") return "active";
  return "installed";
}

export default function AgentNexusApp() {
  const [hydrated, setHydrated] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedModel, setSelectedModel] = useState(modelProviders[0]);
  const [serverState, setServerState] = useState<ServerState>(
    Object.fromEntries(marketplaceServers.map((server) => [server.id, server.status]))
  );
  const [activeServerId, setActiveServerId] = useState("github");

  const servers = useMemo(
    () =>
      marketplaceServers.map((server) => ({
        ...server,
        status: serverState[server.id] ?? server.status
      })),
    [serverState]
  );

  const activeServers = servers.filter((server) => server.status === "active");
  const focusedServer = servers.find((server) => server.id === activeServerId) ?? servers[0];
  const handshake = createMockCapabilityHandshake(focusedServer);

  useEffect(() => {
    setHydrated(true);
  }, []);

  function cycleServerStatus(server: MarketplaceServer) {
    const nextStatus = getNextStatus(server.status);
    setServerState((current) => ({ ...current, [server.id]: nextStatus }));
    setActiveServerId(server.id);
  }

  return (
    <main className="app-shell" data-testid="agentnexus-app" data-hydrated={hydrated}>
      <section className="workspace">
        <aside className="marketplace-panel" aria-label="Marketplace and server manager">
          <header className="brand-header">
            <div className="brand-mark">
              <PlugZap size={22} aria-hidden="true" />
            </div>
            <div>
              <p className="eyebrow">MCP operating layer</p>
              <h1>AgentNexus</h1>
            </div>
          </header>

          <div className="search-control">
            <Search size={18} aria-hidden="true" />
            <input
              aria-label="Search MCP servers"
              placeholder="Search servers, tools, vendors"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          <div className="panel-heading">
            <Store size={18} aria-hidden="true" />
            <h2>Marketplace</h2>
          </div>

          <div className="server-list">
            {servers
              .filter((server) =>
                `${server.name} ${server.vendor} ${server.category} ${server.tools.join(" ")}`
                  .toLowerCase()
                  .includes(query.toLowerCase())
              )
              .map((server) => (
                <article
                  className={`server-card ${server.id === activeServerId ? "selected" : ""}`}
                  key={server.id}
                >
                  <button className="server-main" onClick={() => setActiveServerId(server.id)}>
                    <span className="server-title-row">
                      <strong>{server.name}</strong>
                      <span className={`status-pill ${server.status}`}>{statusLabels[server.status]}</span>
                    </span>
                    <span>{server.description}</span>
                  </button>
                  <div className="server-meta">
                    <span>{server.transport}</span>
                    <span>{server.authMode === "none" ? "No auth" : server.authMode.toUpperCase()}</span>
                    <button
                      className="icon-button"
                      type="button"
                      onClick={() => cycleServerStatus(server)}
                      aria-label={`${server.status === "active" ? "Deactivate" : "Install or activate"} ${server.name}`}
                      title={`${server.status === "active" ? "Deactivate" : "Install or activate"} ${server.name}`}
                    >
                      {server.status === "active" ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                    </button>
                  </div>
                </article>
              ))}
          </div>
        </aside>

        <section className="chat-panel" aria-label="Model agnostic chat playground">
          <header className="topbar">
            <div>
              <p className="eyebrow">Live session</p>
              <h2>Model-agnostic Chat Playground</h2>
            </div>
            <button className="model-picker" type="button" aria-label={`Selected model: ${selectedModel}`}>
              <Bot size={18} aria-hidden="true" />
              <span>{selectedModel}</span>
              <ChevronsUpDown size={16} aria-hidden="true" />
            </button>
            <div className="model-menu" aria-label="Model providers">
              {modelProviders.map((provider) => (
                <button
                  key={provider}
                  className={provider === selectedModel ? "active" : ""}
                  type="button"
                  aria-label={`Select ${provider}`}
                  onClick={() => setSelectedModel(provider)}
                >
                  {provider === selectedModel && <Check size={14} aria-hidden="true" />}
                  {provider}
                </button>
              ))}
            </div>
          </header>

          <div className="session-grid">
            <section className="conversation">
              <div className="message assistant">
                <span className="message-icon">
                  <Activity size={17} aria-hidden="true" />
                </span>
                <div>
                  <strong>Capability handshake ready</strong>
                  <p>{handshake.promptFragment}</p>
                </div>
              </div>
              <div className="message user">
                <div>
                  <strong>Install request</strong>
                  <p>
                    Pull the exposed tool schema, attach stored auth headers when required, and keep active
                    servers available for tool-call routing.
                  </p>
                </div>
              </div>
              <div className="composer">
                <input placeholder="Ask a model to use installed MCP tools..." aria-label="Chat prompt" />
                <button className="send-button" type="button" aria-label="Send prompt" title="Send prompt">
                  <Send size={18} />
                </button>
              </div>
            </section>

            <aside className="runtime-panel" aria-label="Runtime details">
              <section>
                <div className="panel-heading compact">
                  <TerminalSquare size={17} aria-hidden="true" />
                  <h3>Tool Definitions</h3>
                </div>
                <div className="tool-list">
                  {handshake.tools.map((tool) => (
                    <div className="tool-row" key={tool.name}>
                      <strong>{tool.name}</strong>
                      <span>{tool.inputSchema.required.join(", ")} required</span>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <div className="panel-heading compact">
                  <KeyRound size={17} aria-hidden="true" />
                  <h3>Auth Layer</h3>
                </div>
                <div className="auth-state">
                  <ShieldCheck size={18} aria-hidden="true" />
                  <span>
                    {focusedServer.authMode === "none"
                      ? "No token required"
                      : `${focusedServer.authMode.toUpperCase()} token stored in encrypted session scope`}
                  </span>
                </div>
              </section>

              <section>
                <div className="panel-heading compact">
                  <PlugZap size={17} aria-hidden="true" />
                  <h3>Active Servers</h3>
                </div>
                <div className="active-server-list">
                  {activeServers.length === 0 ? (
                    <span>No active integrations</span>
                  ) : (
                    activeServers.map((server) => <span key={server.id}>{server.name}</span>)
                  )}
                </div>
              </section>
            </aside>
          </div>
        </section>
      </section>
    </main>
  );
}
