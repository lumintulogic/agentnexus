import {
  Activity,
  Apple,
  Bot,
  Building2,
  Check,
  ChevronsUpDown,
  Code2,
  Globe,
  KeyRound,
  Link,
  LogOut,
  PlugZap,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Store,
  TerminalSquare,
  ToggleLeft,
  ToggleRight,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { marketplaceServers, modelProviders, type MarketplaceServer } from "@/data/registry";
import {
  createMockCapabilityHandshake,
  createSdkCapabilityHandshake,
  executeMockToolCall,
  type CapabilityHandshake
} from "@/lib/mcp";
import "./AgentNexusApp.css";

type ServerState = Record<string, MarketplaceServer["status"]>;
type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  title: string;
  body: string;
};
type AuthMode = "login" | "signup";
type HandshakeStatus = "idle" | "connecting" | "ready" | "fallback";
type AuthSession = {
  name: string;
  email: string;
  method: string;
};

const statusLabels: Record<MarketplaceServer["status"], string> = {
  active: "Active",
  installed: "Installed",
  available: "Available"
};

const defaultModelIds: Record<string, string> = {
  OpenAI: "gpt-4.1",
  Anthropic: "claude-3-5-sonnet-latest",
  Ollama: "llama3.1",
  Custom: ""
};

const ssoProviders = [
  { id: "google", name: "Google", icon: Globe },
  { id: "github", name: "GitHub", icon: Code2 },
  { id: "microsoft", name: "Microsoft", icon: Building2 },
  { id: "apple", name: "Apple", icon: Apple }
];

const authStorageKey = "agentnexus:auth-session";

function getNextStatus(status: MarketplaceServer["status"]): MarketplaceServer["status"] {
  if (status === "available") return "installed";
  if (status === "installed") return "active";
  return "installed";
}

export default function AgentNexusApp() {
  const [hydrated, setHydrated] = useState(false);
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authName, setAuthName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [query, setQuery] = useState("");
  const [prompt, setPrompt] = useState("");
  const [selectedModel, setSelectedModel] = useState(modelProviders[0]);
  const [connectedModelId, setConnectedModelId] = useState(defaultModelIds[modelProviders[0]]);
  const [modelSecretLabel, setModelSecretLabel] = useState("No model token connected");
  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const [draftProvider, setDraftProvider] = useState(modelProviders[0]);
  const [modelId, setModelId] = useState(defaultModelIds[modelProviders[0]]);
  const [modelEndpoint, setModelEndpoint] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "handshake",
      role: "assistant",
      title: "Capability handshake ready",
      body: ""
    },
    {
      id: "install-request",
      role: "user",
      title: "Install request",
      body: "Pull the exposed tool schema, attach stored auth headers when required, and keep active servers available for tool-call routing."
    }
  ]);
  const [serverState, setServerState] = useState<ServerState>(
    Object.fromEntries(marketplaceServers.map((server) => [server.id, server.status]))
  );
  const [activeServerId, setActiveServerId] = useState("github");
  const [handshakeByServerId, setHandshakeByServerId] = useState<Record<string, CapabilityHandshake>>({});
  const [handshakeStatusByServerId, setHandshakeStatusByServerId] = useState<Record<string, HandshakeStatus>>({});
  const [handshakeErrorByServerId, setHandshakeErrorByServerId] = useState<Record<string, string>>({});
  const [handshakeAttempt, setHandshakeAttempt] = useState(0);

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
  const fallbackHandshake = useMemo(() => createMockCapabilityHandshake(focusedServer), [focusedServer]);
  const handshake = handshakeByServerId[focusedServer.id] ?? fallbackHandshake;
  const handshakeStatus = handshakeStatusByServerId[focusedServer.id] ?? "idle";
  const handshakeError = handshakeErrorByServerId[focusedServer.id];
  const visibleMessages = messages.map((message) =>
    message.id === "handshake" ? { ...message, body: handshake.promptFragment } : message
  );

  useEffect(() => {
    const storedSession = sessionStorage.getItem(authStorageKey);
    if (storedSession) {
      try {
        setAuthSession(JSON.parse(storedSession) as AuthSession);
      } catch {
        sessionStorage.removeItem(authStorageKey);
      }
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!authSession) return;

    let cancelled = false;
    const fallback = createMockCapabilityHandshake(focusedServer);

    if (focusedServer.transport !== "WebSocket") {
      setHandshakeByServerId((current) => ({ ...current, [focusedServer.id]: fallback }));
      setHandshakeStatusByServerId((current) => ({ ...current, [focusedServer.id]: "fallback" }));
      setHandshakeErrorByServerId((current) => {
        const { [focusedServer.id]: _removed, ...rest } = current;
        return rest;
      });
      return;
    }

    setHandshakeByServerId((current) => ({ ...current, [focusedServer.id]: current[focusedServer.id] ?? fallback }));
    setHandshakeStatusByServerId((current) => ({ ...current, [focusedServer.id]: "connecting" }));
    setHandshakeErrorByServerId((current) => {
      const { [focusedServer.id]: _removed, ...rest } = current;
      return rest;
    });

    createSdkCapabilityHandshake(focusedServer)
      .then((sdkHandshake) => {
        if (cancelled) return;
        setHandshakeByServerId((current) => ({ ...current, [focusedServer.id]: sdkHandshake }));
        setHandshakeStatusByServerId((current) => ({ ...current, [focusedServer.id]: "ready" }));
      })
      .catch((error) => {
        if (cancelled) return;
        setHandshakeByServerId((current) => ({ ...current, [focusedServer.id]: fallback }));
        setHandshakeStatusByServerId((current) => ({ ...current, [focusedServer.id]: "fallback" }));
        setHandshakeErrorByServerId((current) => ({
          ...current,
          [focusedServer.id]: error instanceof Error ? error.message : "MCP SDK handshake failed."
        }));
      });

    return () => {
      cancelled = true;
    };
  }, [authSession, focusedServer, handshakeAttempt]);

  function createAuthSession(session: AuthSession) {
    sessionStorage.setItem(authStorageKey, JSON.stringify(session));
    setAuthSession(session);
  }

  function submitAuth(event: { preventDefault: () => void }) {
    event.preventDefault();
    const email = authEmail.trim();
    if (!email || authPassword.trim().length < 8 || (authMode === "signup" && !authName.trim())) return;

    createAuthSession({
      name: authMode === "signup" ? authName.trim() : email.split("@")[0],
      email,
      method: authMode === "signup" ? "Email sign-up" : "Email login"
    });
    setAuthPassword("");
  }

  function continueWithSso(provider: string) {
    createAuthSession({
      name: `${provider} User`,
      email: `${provider.toLowerCase()}@agentnexus.local`,
      method: `${provider} SSO`
    });
  }

  function signOut() {
    sessionStorage.removeItem(authStorageKey);
    setAuthSession(null);
    setAuthPassword("");
  }

  function cycleServerStatus(server: MarketplaceServer) {
    const nextStatus = getNextStatus(server.status);
    setServerState((current) => ({ ...current, [server.id]: nextStatus }));
    setActiveServerId(server.id);
  }

  function selectDraftProvider(provider: string) {
    setDraftProvider(provider);
    setModelId(defaultModelIds[provider] ?? "");
    setModelEndpoint(provider === "Ollama" ? "http://localhost:11434" : "");
    setApiKey("");
  }

  function connectModel(event: { preventDefault: () => void }) {
    event.preventDefault();
    setSelectedModel(draftProvider);
    setConnectedModelId(modelId.trim());
    setModelSecretLabel(
      requiresApiKey
        ? `Encrypted ${draftProvider} token stored in session vault`
        : `${draftProvider} local endpoint connected`
    );
    sessionStorage.setItem(
      "agentnexus:model-connection",
      JSON.stringify({
        provider: draftProvider,
        modelId: modelId.trim(),
        endpoint: modelEndpoint.trim() || null,
        tokenRef: requiresApiKey ? `session:${crypto.randomUUID()}` : null
      })
    );
    setModelDialogOpen(false);
  }

  function sendPrompt() {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) return;

    const [command, toolName, ...queryParts] = trimmedPrompt.split(" ");
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      title: "User prompt",
      body: trimmedPrompt
    };

    if (command === "/tool" && toolName) {
      try {
        const result = executeMockToolCall(focusedServer, toolName, queryParts.join(" ") || "No query supplied");
        setMessages((current) => [
          ...current,
          userMessage,
          {
            id: `tool-${Date.now()}`,
            role: "assistant",
            title: `${result.toolName} result`,
            body: result.content
          }
        ]);
      } catch (error) {
        setMessages((current) => [
          ...current,
          userMessage,
          {
            id: `tool-error-${Date.now()}`,
            role: "assistant",
            title: "Tool call blocked",
            body: error instanceof Error ? error.message : "The selected tool call could not be executed."
          }
        ]);
      }
    } else {
      setMessages((current) => [
        ...current,
        userMessage,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          title: `${selectedModel} routed prompt`,
          body: `Using ${connectedModelId}, AgentNexus would route this prompt with ${activeServers.length} active MCP integration${activeServers.length === 1 ? "" : "s"}.`
        }
      ]);
    }

    setPrompt("");
  }

  const requiresEndpoint = draftProvider === "Custom" || draftProvider === "Ollama";
  const requiresApiKey = draftProvider !== "Ollama";
  const canConnect =
    modelId.trim().length > 0 &&
    (!requiresEndpoint || modelEndpoint.trim().length > 0) &&
    (!requiresApiKey || apiKey.trim().length > 0);
  const canSubmitAuth =
    authEmail.trim().length > 0 &&
    authPassword.trim().length >= 8 &&
    (authMode === "login" || authName.trim().length > 0);

  if (!authSession) {
    return (
      <main className="app-shell auth-shell" data-testid="agentnexus-app" data-hydrated={hydrated}>
        <section className="auth-panel" aria-label="Authentication">
          <header className="brand-header auth-brand">
            <div className="brand-mark">
              <PlugZap size={22} aria-hidden="true" />
            </div>
            <div>
              <p className="eyebrow">MCP operating layer</p>
              <h1>AgentNexus</h1>
            </div>
          </header>

          <div className="auth-copy">
            <p className="eyebrow">Secure workspace</p>
            <h2>{authMode === "login" ? "Log in to your dashboard" : "Create your workspace"}</h2>
          </div>

          <div className="auth-mode-switch" aria-label="Authentication mode">
            <button
              className={authMode === "login" ? "active" : ""}
              type="button"
              aria-pressed={authMode === "login"}
              onClick={() => setAuthMode("login")}
            >
              Log in
            </button>
            <button
              className={authMode === "signup" ? "active" : ""}
              type="button"
              aria-pressed={authMode === "signup"}
              onClick={() => setAuthMode("signup")}
            >
              Sign up
            </button>
          </div>

          <div className="sso-grid">
            {ssoProviders.map(({ id, name, icon: Icon }) => (
              <button key={id} className="sso-button" type="button" onClick={() => continueWithSso(name)}>
                <Icon size={17} aria-hidden="true" />
                <span>{name}</span>
              </button>
            ))}
          </div>

          <form className="auth-form" onSubmit={submitAuth}>
            {authMode === "signup" && (
              <label className="field-control">
                <span>Name</span>
                <input
                  aria-label="Name"
                  value={authName}
                  placeholder="Workspace owner"
                  onChange={(event) => setAuthName(event.target.value)}
                  required
                />
              </label>
            )}

            <label className="field-control">
              <span>Email</span>
              <input
                aria-label="Email"
                type="email"
                value={authEmail}
                placeholder="you@example.com"
                onChange={(event) => setAuthEmail(event.target.value)}
                required
              />
            </label>

            <label className="field-control">
              <span>Password</span>
              <input
                aria-label="Password"
                type="password"
                value={authPassword}
                placeholder="Minimum 8 characters"
                onChange={(event) => setAuthPassword(event.target.value)}
                required
                minLength={8}
              />
            </label>

            <button className="primary-button auth-submit" type="submit" disabled={!canSubmitAuth}>
              {authMode === "login" ? "Log in" : "Create account"}
            </button>
          </form>
        </section>
      </main>
    );
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

          <div className="session-card" aria-label="Current account">
            <span>
              <strong>{authSession.name}</strong>
              <small>{authSession.method}</small>
            </span>
            <button className="icon-button" type="button" aria-label="Sign out" title="Sign out" onClick={signOut}>
              <LogOut size={18} aria-hidden="true" />
            </button>
          </div>

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
            <button
              className="model-picker"
              type="button"
              aria-label={`Selected model: ${selectedModel}`}
              onClick={() => {
                setDraftProvider(selectedModel);
                setModelDialogOpen(true);
              }}
            >
              <Bot size={18} aria-hidden="true" />
              <span>{selectedModel}</span>
              <ChevronsUpDown size={16} aria-hidden="true" />
            </button>
          </header>

          <div className="session-grid">
            <section className="conversation">
              {visibleMessages.map((message) => (
                <div className={`message ${message.role}`} key={message.id}>
                  {message.role === "assistant" && (
                    <span className="message-icon">
                      <Activity size={17} aria-hidden="true" />
                    </span>
                  )}
                  <div>
                    <strong>{message.title}</strong>
                    <p>{message.body}</p>
                  </div>
                </div>
              ))}
              <div className="composer">
                <input
                  placeholder={`Ask ${connectedModelId} to use installed MCP tools...`}
                  aria-label="Chat prompt"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") sendPrompt();
                  }}
                />
                <button className="send-button" type="button" aria-label="Send prompt" title="Send prompt" onClick={sendPrompt}>
                  <Send size={18} />
                </button>
              </div>
            </section>

            <aside className="runtime-panel" aria-label="Runtime details">
              <section>
                <div className="panel-heading compact split">
                  <span>
                    <TerminalSquare size={17} aria-hidden="true" />
                    <h3>Tool Definitions</h3>
                  </span>
                  {focusedServer.transport === "WebSocket" && (
                    <button
                      className="icon-button small"
                      type="button"
                      aria-label={`Refresh ${focusedServer.name} MCP handshake`}
                      title={`Refresh ${focusedServer.name} MCP handshake`}
                      onClick={() => setHandshakeAttempt((attempt) => attempt + 1)}
                    >
                      <RefreshCw size={15} aria-hidden="true" />
                    </button>
                  )}
                </div>
                <div className={`handshake-state ${handshakeStatus}`}>
                  {handshakeStatus === "connecting"
                    ? "Connecting to MCP server"
                    : handshake.source === "sdk"
                      ? "SDK-discovered MCP tools"
                      : "Registry capability fallback"}
                </div>
                {handshakeError && <div className="handshake-error">{handshakeError}</div>}
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
                <div className="auth-state">
                  <Bot size={18} aria-hidden="true" />
                  <span>{modelSecretLabel}</span>
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

      {modelDialogOpen && (
        <div className="dialog-backdrop" role="presentation">
          <section
            aria-labelledby="connect-model-title"
            aria-modal="true"
            className="model-dialog"
            role="dialog"
          >
            <header className="dialog-header">
              <div>
                <p className="eyebrow">Model connection</p>
                <h2 id="connect-model-title">Connect a Model</h2>
              </div>
              <button
                aria-label="Close dialog"
                className="icon-button"
                type="button"
                onClick={() => setModelDialogOpen(false)}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </header>

            <form className="model-form" onSubmit={connectModel}>
              <div className="provider-tabs" aria-label="Model providers">
                {modelProviders.map((provider) => (
                  <button
                    key={provider}
                    className={provider === draftProvider ? "active" : ""}
                    type="button"
                    aria-pressed={provider === draftProvider}
                    onClick={() => selectDraftProvider(provider)}
                  >
                    {provider === draftProvider && <Check size={14} aria-hidden="true" />}
                    {provider}
                  </button>
                ))}
              </div>

              <label className="field-control">
                <span>Model ID</span>
                <input
                  aria-label="Model ID"
                  value={modelId}
                  placeholder="gpt-4.1, claude-3-5-sonnet-latest, llama3.1"
                  onChange={(event) => setModelId(event.target.value)}
                  required
                />
              </label>

              {requiresEndpoint && (
                <label className="field-control">
                  <span>Endpoint</span>
                  <input
                    aria-label="Model endpoint"
                    value={modelEndpoint}
                    placeholder={draftProvider === "Ollama" ? "http://localhost:11434" : "https://api.example.com/v1"}
                    onChange={(event) => setModelEndpoint(event.target.value)}
                    required
                  />
                </label>
              )}

              {requiresApiKey && (
                <label className="field-control">
                  <span>API key</span>
                  <input
                    aria-label="API key"
                    type="password"
                    value={apiKey}
                    placeholder="Stored only for this browser session"
                    onChange={(event) => setApiKey(event.target.value)}
                    required
                  />
                </label>
              )}

              <div className="connection-summary">
                <Link size={17} aria-hidden="true" />
                <span>
                  {draftProvider} will route chat requests through {modelId.trim() || "the selected model"}.
                </span>
              </div>

              <div className="dialog-actions">
                <button className="secondary-button" type="button" onClick={() => setModelDialogOpen(false)}>
                  Cancel
                </button>
                <button className="primary-button" type="submit" disabled={!canConnect}>
                  Connect model
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
