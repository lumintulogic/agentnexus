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
  buildDirectusKeycloakLoginUrl,
  loadDirectusAuthSession,
  loadDirectusMarketplaceServers,
  persistDirectusModelConnection,
  persistDirectusPrivateMcpRegistration,
  persistDirectusServerInstall,
  readDirectusAccessToken
} from "@/lib/directus";
import {
  createMockCapabilityHandshake,
  createSdkCapabilityHandshake,
  executeMockToolCall,
  executeSdkToolCall,
  type CapabilityHandshake
} from "@/lib/mcp";
import { openSessionSecret, readEncryptedSessionSecrets, removeSessionSecret, sealSessionSecret } from "@/lib/session-vault";
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
type ServerCredential = {
  mode: MarketplaceServer["authMode"];
  tokenRef: string;
  label: string;
  authorizationHeader?: string;
};
type AuthSession = {
  name: string;
  email: string;
  method: string;
  accessToken?: string;
  authTokenRef?: string;
  directusUserId?: string;
  profileId?: string;
};
type RegistrySource = "fallback" | "directus";
type EnterpriseDraft = {
  tenantName: string;
  appName: string;
  appUrl: string;
  roleName: string;
  serverName: string;
  endpointUrl: string;
  customHeaderName: string;
  tools: string;
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
const authSecretVaultStorageKey = "agentnexus:auth-secret-vault";
const serverCredentialStorageKey = "agentnexus:server-credentials";
const serverSecretVaultStorageKey = "agentnexus:server-secret-vault";

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
  const [registryServers, setRegistryServers] = useState<MarketplaceServer[]>(marketplaceServers);
  const [registrySource, setRegistrySource] = useState<RegistrySource>("fallback");
  const [registryError, setRegistryError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState("Session state only");
  const [query, setQuery] = useState("");
  const [prompt, setPrompt] = useState("");
  const [selectedModel, setSelectedModel] = useState(modelProviders[0]);
  const [connectedModelId, setConnectedModelId] = useState(defaultModelIds[modelProviders[0]]);
  const [modelSecretLabel, setModelSecretLabel] = useState("No model token connected");
  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const [enterpriseDialogOpen, setEnterpriseDialogOpen] = useState(false);
  const [enterpriseDraft, setEnterpriseDraft] = useState<EnterpriseDraft>({
    tenantName: "Acme Premium",
    appName: "Acme Analyst App",
    appUrl: "https://acme.example/app",
    roleName: "analyst",
    serverName: "Acme Private Reports",
    endpointUrl: "https://mcp.acme.example/reports",
    customHeaderName: "X-Acme-Workspace",
    tools: "search_reports, summarize_report"
  });
  const [draftProvider, setDraftProvider] = useState(modelProviders[0]);
  const [modelId, setModelId] = useState(defaultModelIds[modelProviders[0]]);
  const [modelEndpoint, setModelEndpoint] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [serverCredentials, setServerCredentials] = useState<Record<string, ServerCredential>>({});
  const [authDialogServerId, setAuthDialogServerId] = useState<string | null>(null);
  const [pendingServerStatus, setPendingServerStatus] = useState<MarketplaceServer["status"] | null>(null);
  const [serverTokenDraft, setServerTokenDraft] = useState("");
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
      registryServers.map((server) => ({
        ...server,
        status: serverState[server.id] ?? server.status
      })),
    [registryServers, serverState]
  );

  const activeServers = servers.filter((server) => server.status === "active");
  const focusedServer = servers.find((server) => server.id === activeServerId) ?? servers[0];
  const authDialogServer = authDialogServerId
    ? servers.find((server) => server.id === authDialogServerId) ?? null
    : null;
  const focusedCredential = serverCredentials[focusedServer.id];
  const focusedCredentialReady = Boolean(focusedCredential?.authorizationHeader);
  const fallbackHandshake = useMemo(() => createMockCapabilityHandshake(focusedServer), [focusedServer]);
  const handshake = handshakeByServerId[focusedServer.id] ?? fallbackHandshake;
  const handshakeStatus = handshakeStatusByServerId[focusedServer.id] ?? "idle";
  const handshakeError = handshakeErrorByServerId[focusedServer.id];
  const visibleMessages = messages.map((message) =>
    message.id === "handshake" ? { ...message, body: handshake.promptFragment } : message
  );

  useEffect(() => {
    const directusToken = readDirectusAccessToken(window.location.search);
    if (directusToken) {
      loadDirectusAuthSession(directusToken)
        .then((session) => {
          void createAuthSession(session);
          window.history.replaceState(null, "", window.location.pathname);
        })
        .catch(() => {
          window.history.replaceState(null, "", window.location.pathname);
        });
    }

    const storedSession = sessionStorage.getItem(authStorageKey);
    let restoredSession = false;
    if (storedSession) {
      try {
        const session = JSON.parse(storedSession) as AuthSession;
        if (session.authTokenRef) {
          const vaultRecord = readEncryptedSessionSecrets(authSecretVaultStorageKey)[session.authTokenRef];
          if (vaultRecord) {
            openSessionSecret(vaultRecord)
              .then((accessToken) => {
                setAuthSession({ ...session, accessToken });
              })
              .catch(() => {
                setAuthSession(session);
              });
          } else {
            setAuthSession(session);
          }
        } else {
          setAuthSession(session);
        }
        restoredSession = true;
      } catch {
        sessionStorage.removeItem(authStorageKey);
      }
    }
    if (!directusToken && !restoredSession) {
      loadDirectusAuthSession()
        .then((session) => {
          void createAuthSession(session);
        })
        .catch(() => undefined);
    }
    const storedCredentials = sessionStorage.getItem(serverCredentialStorageKey);
    if (storedCredentials) {
      try {
        const storedRefs = JSON.parse(storedCredentials) as Record<string, ServerCredential>;
        const vaultRefs = readEncryptedSessionSecrets(serverSecretVaultStorageKey);
        setServerCredentials(
          Object.fromEntries(
            Object.entries(storedRefs)
              .filter(([, credential]) => Boolean(vaultRefs[credential.tokenRef]))
              .map(([serverId, credential]) => [
                serverId,
                {
                  mode: credential.mode,
                  tokenRef: credential.tokenRef,
                  label: "Encrypted token reference saved; reconnect to attach Authorization"
                }
              ])
          )
        );
      } catch {
        sessionStorage.removeItem(serverCredentialStorageKey);
      }
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    let cancelled = false;

    loadDirectusMarketplaceServers()
      .then((directusServers) => {
        if (cancelled) return;
        setRegistryServers(directusServers);
        setRegistrySource("directus");
        setRegistryError(null);
        setServerState((current) =>
          Object.fromEntries(directusServers.map((server) => [server.id, current[server.id] ?? server.status]))
        );
        setActiveServerId((current) =>
          directusServers.some((server) => server.id === current) ? current : (directusServers[0]?.id ?? current)
        );
      })
      .catch((error) => {
        if (cancelled) return;
        setRegistrySource("fallback");
        setRegistryError(error instanceof Error ? error.message : "Directus marketplace lookup failed.");
      });

    return () => {
      cancelled = true;
    };
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

  async function createAuthSession(session: AuthSession) {
    let authTokenRef = session.authTokenRef;
    if (session.accessToken) {
      authTokenRef = `directus:${session.directusUserId ?? session.email}:${crypto.randomUUID()}`;
      await sealSessionSecret(authSecretVaultStorageKey, authTokenRef, session.accessToken);
    }
    const { accessToken: _accessToken, ...storedSession } = { ...session, authTokenRef };
    sessionStorage.setItem(authStorageKey, JSON.stringify(storedSession));
    setAuthSession({ ...session, authTokenRef });
  }

  function submitAuth(event: { preventDefault: () => void }) {
    event.preventDefault();
    const email = authEmail.trim();
    if (!email || authPassword.trim().length < 8 || (authMode === "signup" && !authName.trim())) return;

    void createAuthSession({
      name: authMode === "signup" ? authName.trim() : email.split("@")[0],
      email,
      method: authMode === "signup" ? "Email sign-up" : "Email login"
    });
    setAuthPassword("");
  }

  function continueWithSso(provider: string) {
    void createAuthSession({
      name: `${provider} User`,
      email: `${provider.toLowerCase()}@agentnexus.local`,
      method: `${provider} SSO`
    });
  }

  function continueWithKeycloak() {
    window.location.assign(buildDirectusKeycloakLoginUrl(window.location.href));
  }

  function signOut() {
    sessionStorage.removeItem(authStorageKey);
    sessionStorage.removeItem(authSecretVaultStorageKey);
    setAuthSession(null);
    setAuthPassword("");
  }

  async function cycleServerStatus(server: MarketplaceServer) {
    const nextStatus = getNextStatus(server.status);
    if (server.authMode !== "none" && !serverCredentials[server.id]?.authorizationHeader) {
      setActiveServerId(server.id);
      setAuthDialogServerId(server.id);
      setPendingServerStatus(nextStatus);
      setServerTokenDraft("");
      return;
    }
    setServerState((current) => ({ ...current, [server.id]: nextStatus }));
    setActiveServerId(server.id);
    if (registrySource === "directus") {
      try {
        const result = await persistDirectusServerInstall({
          accessToken: authSession?.accessToken,
          profileId: authSession?.profileId,
          serverId: server.id,
          status: nextStatus,
          lastToolSchema: handshake.tools
        });
        setSyncStatus(result.detail);
      } catch (error) {
        setSyncStatus(error instanceof Error ? error.message : "Directus install sync failed");
      }
    } else {
      setSyncStatus("Using session-only install state");
    }
  }

  function persistServerCredentials(nextCredentials: Record<string, ServerCredential>) {
    const persistedRefs = Object.fromEntries(
      Object.entries(nextCredentials).map(([serverId, credential]) => [
        serverId,
        {
          mode: credential.mode,
          tokenRef: credential.tokenRef,
          label: credential.label
        }
      ])
    );
    sessionStorage.setItem(serverCredentialStorageKey, JSON.stringify(persistedRefs));
    setServerCredentials(nextCredentials);
  }

  async function connectServerCredential(server: MarketplaceServer) {
    if (server.authMode === "bearer" && serverTokenDraft.trim().length < 8) return;

    const tokenRef = `session:${server.id}:${crypto.randomUUID()}`;
    const authorizationHeader =
      server.authMode === "oauth"
        ? `Bearer oauth_${crypto.randomUUID()}`
        : `Bearer ${serverTokenDraft.trim()}`;
    await sealSessionSecret(serverSecretVaultStorageKey, tokenRef, authorizationHeader);
    const credential: ServerCredential = {
      mode: server.authMode,
      tokenRef,
      authorizationHeader,
      label:
        server.authMode === "oauth"
          ? `OAuth token linked for ${server.vendor}`
          : `Bearer token ${serverTokenDraft.trim().slice(0, 4)}... stored for this session`
    };
    const nextCredentials = { ...serverCredentials, [server.id]: credential };

    persistServerCredentials(nextCredentials);
    const nextStatus = pendingServerStatus ?? getNextStatus(server.status);
    setServerState((current) => ({ ...current, [server.id]: nextStatus }));
    setActiveServerId(server.id);
    setAuthDialogServerId(null);
    setPendingServerStatus(null);
    setServerTokenDraft("");
    if (registrySource === "directus") {
      persistDirectusServerInstall({
        accessToken: authSession?.accessToken,
        profileId: authSession?.profileId,
        serverId: server.id,
        status: nextStatus,
        lastToolSchema: handshake.tools
      })
        .then((result) => setSyncStatus(result.detail))
        .catch((error) => setSyncStatus(error instanceof Error ? error.message : "Directus install sync failed"));
    } else {
      setSyncStatus("Using session-only install state");
    }
  }

  function clearServerCredential(serverId: string) {
    const tokenRef = serverCredentials[serverId]?.tokenRef;
    if (tokenRef) removeSessionSecret(serverSecretVaultStorageKey, tokenRef);
    const { [serverId]: _removed, ...rest } = serverCredentials;
    persistServerCredentials(rest);
  }

  function selectDraftProvider(provider: string) {
    setDraftProvider(provider);
    setModelId(defaultModelIds[provider] ?? "");
    setModelEndpoint(provider === "Ollama" ? "http://localhost:11434" : "");
    setApiKey("");
  }

  function buildEnterpriseOidcUrl(context: NonNullable<MarketplaceServer["tenantContext"]>, clientId: string) {
    const url = new URL("/oidc/authorize", window.location.origin);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", context.appUrl);
    url.searchParams.set("scope", "openid profile email agentnexus.enterprise");
    url.searchParams.set("login_hint", authSession?.email ?? "common-user@agentnexus.local");
    url.searchParams.set("tenant_id", context.tenantId);
    url.searchParams.set("app_id", context.appId);
    url.searchParams.set("app_url", context.appUrl);
    url.searchParams.set("role_id", context.roleId);
    url.searchParams.set("role_name", context.roleName);
    return url.toString();
  }

  async function registerPrivateMcp(event: { preventDefault: () => void }) {
    event.preventDefault();
    const tenantId = `tenant:${crypto.randomUUID()}`;
    const appId = `app:${crypto.randomUUID()}`;
    const roleId = `role:${crypto.randomUUID()}`;
    const serverId = `private:${crypto.randomUUID()}`;
    const tools = enterpriseDraft.tools
      .split(",")
      .map((tool) => tool.trim())
      .filter(Boolean);
    const context = {
      tenantId,
      appId,
      appUrl: enterpriseDraft.appUrl.trim(),
      roleId,
      roleName: enterpriseDraft.roleName.trim(),
      oidcAuthorizeUrl: ""
    };
    const oidcAuthorizeUrl = buildEnterpriseOidcUrl(context, `anx_${appId.replace(/[^a-zA-Z0-9]/g, "")}`);
    const privateServer: MarketplaceServer = {
      id: serverId,
      name: enterpriseDraft.serverName.trim(),
      vendor: enterpriseDraft.tenantName.trim(),
      category: "Private",
      transport: "HTTP/SSE",
      authMode: "oauth",
      status: "installed",
      endpoint: enterpriseDraft.endpointUrl.trim(),
      description: `Private MCP server for ${enterpriseDraft.appName.trim()} with ${enterpriseDraft.roleName.trim()} role scope.`,
      tools,
      visibility: "private",
      tenantContext: { ...context, oidcAuthorizeUrl }
    };

    setRegistryServers((current) => [privateServer, ...current.filter((server) => server.id !== serverId)]);
    setServerState((current) => ({ ...current, [serverId]: "installed" }));
    setActiveServerId(serverId);
    setEnterpriseDialogOpen(false);

    try {
      const result = await persistDirectusPrivateMcpRegistration({
        accessToken: authSession?.accessToken,
        profileId: authSession?.profileId,
        tenantName: enterpriseDraft.tenantName.trim(),
        appName: enterpriseDraft.appName.trim(),
        appUrl: enterpriseDraft.appUrl.trim(),
        roleName: enterpriseDraft.roleName.trim(),
        serverName: enterpriseDraft.serverName.trim(),
        endpointUrl: enterpriseDraft.endpointUrl.trim(),
        customHeaderName: enterpriseDraft.customHeaderName.trim() || null,
        tools
      });
      setSyncStatus(result.detail);
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : "Directus private MCP registration failed");
    }
  }

  async function connectModel(event: { preventDefault: () => void }) {
    event.preventDefault();
    const tokenRef = requiresApiKey ? `session:${crypto.randomUUID()}` : null;
    setSelectedModel(draftProvider);
    setConnectedModelId(modelId.trim());
    setModelSecretLabel(
      requiresApiKey
        ? `${draftProvider} token reference stored for this session`
        : `${draftProvider} local endpoint connected`
    );
    sessionStorage.setItem(
      "agentnexus:model-connection",
      JSON.stringify({
        provider: draftProvider,
        modelId: modelId.trim(),
        endpoint: modelEndpoint.trim() || null,
        tokenRef
      })
    );
    try {
      const result = await persistDirectusModelConnection({
        accessToken: authSession?.accessToken,
        profileId: authSession?.profileId,
        provider: draftProvider,
        modelId: modelId.trim(),
        endpointUrl: modelEndpoint.trim() || null,
        tokenRef
      });
      setSyncStatus(result.detail);
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : "Directus model sync failed");
    }
    setModelDialogOpen(false);
  }

  async function sendPrompt() {
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
        if (focusedServer.authMode !== "none" && !focusedCredentialReady) {
          setAuthDialogServerId(focusedServer.id);
          setPendingServerStatus(focusedServer.status === "available" ? "installed" : focusedServer.status);
          setMessages((current) => [
            ...current,
            userMessage,
            {
              id: `tool-auth-${Date.now()}`,
              role: "assistant",
              title: "Tool call needs authorization",
              body: `${focusedServer.name} requires ${focusedServer.authMode.toUpperCase()} credentials before AgentNexus can attach Authorization and execute ${toolName}.`
            }
          ]);
          setPrompt("");
          return;
        }

        const authContext = focusedCredential?.authorizationHeader
          ? {
              tokenRef: focusedCredential.tokenRef,
              authorizationHeader: focusedCredential.authorizationHeader
            }
          : {};
        const result =
          handshake.source === "sdk"
            ? await executeSdkToolCall(focusedServer, toolName, queryParts.join(" ") || "No query supplied", authContext)
            : executeMockToolCall(focusedServer, toolName, queryParts.join(" ") || "No query supplied", authContext);
        setMessages((current) => [
          ...current,
          userMessage,
          {
            id: `tool-${Date.now()}`,
            role: "assistant",
            title: `${result.toolName} result`,
            body: `${result.content} (${result.source.toUpperCase()} execution${
              result.authAttached ? ", Authorization attached" : ""
            })`
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
  const canConnectServerCredential =
    authDialogServer?.authMode === "oauth" ||
    (authDialogServer?.authMode === "bearer" && serverTokenDraft.trim().length >= 8);
  const canRegisterPrivateMcp =
    enterpriseDraft.tenantName.trim().length > 0 &&
    enterpriseDraft.appName.trim().length > 0 &&
    enterpriseDraft.appUrl.trim().startsWith("http") &&
    enterpriseDraft.roleName.trim().length > 0 &&
    enterpriseDraft.serverName.trim().length > 0 &&
    enterpriseDraft.endpointUrl.trim().startsWith("http") &&
    enterpriseDraft.tools.split(",").some((tool) => tool.trim().length > 0);

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
            <button className="sso-button directus-sso" type="button" onClick={continueWithKeycloak}>
              <ShieldCheck size={17} aria-hidden="true" />
              <span>Keycloak</span>
            </button>
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
            <small>{registrySource === "directus" ? "Directus registry" : "Prototype registry"}</small>
          </div>
          {registryError && <p className="panel-note">{registryError}</p>}
          <button className="primary-button full-width" type="button" onClick={() => setEnterpriseDialogOpen(true)}>
            Register private MCP
          </button>

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
                    {server.visibility === "private" && <span>Private</span>}
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
                      : focusedCredentialReady
                        ? focusedCredential?.label
                        : focusedCredential?.label ?? `${focusedServer.authMode.toUpperCase()} token required`}
                  </span>
                </div>
                {focusedCredential && (
                  <button
                    className="secondary-button inline-action"
                    type="button"
                    onClick={() => clearServerCredential(focusedServer.id)}
                  >
                    Forget server token
                  </button>
                )}
                <div className="auth-state">
                  <Bot size={18} aria-hidden="true" />
                  <span>{modelSecretLabel}</span>
                </div>
                <div className="auth-state">
                  <Store size={18} aria-hidden="true" />
                  <span>{syncStatus}</span>
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

              {focusedServer.tenantContext && (
                <section>
                  <div className="panel-heading compact">
                    <ShieldCheck size={17} aria-hidden="true" />
                    <h3>Enterprise Context</h3>
                  </div>
                  <div className="tool-list">
                    <div className="tool-row">
                      <strong>{focusedServer.tenantContext.roleName}</strong>
                      <span>{focusedServer.tenantContext.tenantId}</span>
                    </div>
                    <div className="tool-row">
                      <strong>OIDC authorize URL</strong>
                      <span>{focusedServer.tenantContext.oidcAuthorizeUrl}</span>
                    </div>
                  </div>
                </section>
              )}
            </aside>
          </div>
        </section>
      </section>

      {enterpriseDialogOpen && (
        <div className="dialog-backdrop" role="presentation">
          <section
            aria-labelledby="private-mcp-title"
            aria-modal="true"
            className="model-dialog"
            role="dialog"
          >
            <header className="dialog-header">
              <div>
                <p className="eyebrow">Enterprise private integration</p>
                <h2 id="private-mcp-title">Register Private MCP</h2>
              </div>
              <button
                aria-label="Close private MCP dialog"
                className="icon-button"
                type="button"
                onClick={() => setEnterpriseDialogOpen(false)}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </header>

            <form className="model-form" onSubmit={registerPrivateMcp}>
              <label className="field-control">
                <span>Tenant name</span>
                <input
                  aria-label="Tenant name"
                  value={enterpriseDraft.tenantName}
                  onChange={(event) => setEnterpriseDraft((current) => ({ ...current, tenantName: event.target.value }))}
                  required
                />
              </label>
              <label className="field-control">
                <span>App name</span>
                <input
                  aria-label="App name"
                  value={enterpriseDraft.appName}
                  onChange={(event) => setEnterpriseDraft((current) => ({ ...current, appName: event.target.value }))}
                  required
                />
              </label>
              <label className="field-control">
                <span>App URL</span>
                <input
                  aria-label="App URL"
                  value={enterpriseDraft.appUrl}
                  onChange={(event) => setEnterpriseDraft((current) => ({ ...current, appUrl: event.target.value }))}
                  required
                />
              </label>
              <label className="field-control">
                <span>Role name</span>
                <input
                  aria-label="Role name"
                  value={enterpriseDraft.roleName}
                  onChange={(event) => setEnterpriseDraft((current) => ({ ...current, roleName: event.target.value }))}
                  required
                />
              </label>
              <label className="field-control">
                <span>Server name</span>
                <input
                  aria-label="Server name"
                  value={enterpriseDraft.serverName}
                  onChange={(event) => setEnterpriseDraft((current) => ({ ...current, serverName: event.target.value }))}
                  required
                />
              </label>
              <label className="field-control">
                <span>MCP endpoint</span>
                <input
                  aria-label="MCP endpoint"
                  value={enterpriseDraft.endpointUrl}
                  onChange={(event) => setEnterpriseDraft((current) => ({ ...current, endpointUrl: event.target.value }))}
                  required
                />
              </label>
              <label className="field-control">
                <span>Custom header</span>
                <input
                  aria-label="Custom header"
                  value={enterpriseDraft.customHeaderName}
                  onChange={(event) =>
                    setEnterpriseDraft((current) => ({ ...current, customHeaderName: event.target.value }))
                  }
                />
              </label>
              <label className="field-control">
                <span>Tools</span>
                <input
                  aria-label="Private MCP tools"
                  value={enterpriseDraft.tools}
                  onChange={(event) => setEnterpriseDraft((current) => ({ ...current, tools: event.target.value }))}
                  required
                />
              </label>

              <div className="connection-summary">
                <ShieldCheck size={17} aria-hidden="true" />
                <span>Invited users receive identity plus tenant/app/role claims for this private MCP app.</span>
              </div>

              <div className="dialog-actions">
                <button className="secondary-button" type="button" onClick={() => setEnterpriseDialogOpen(false)}>
                  Cancel
                </button>
                <button className="primary-button" type="submit" disabled={!canRegisterPrivateMcp}>
                  Register private server
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

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

      {authDialogServer && (
        <div className="dialog-backdrop" role="presentation">
          <section
            aria-labelledby="connect-server-auth-title"
            aria-modal="true"
            className="model-dialog"
            role="dialog"
          >
            <header className="dialog-header">
              <div>
                <p className="eyebrow">Server authorization</p>
                <h2 id="connect-server-auth-title">Connect {authDialogServer.name}</h2>
              </div>
              <button
                aria-label="Close server authorization dialog"
                className="icon-button"
                type="button"
                onClick={() => {
                  setAuthDialogServerId(null);
                  setPendingServerStatus(null);
                  setServerTokenDraft("");
                }}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </header>

            <div className="model-form">
              <div className="connection-summary">
                <KeyRound size={17} aria-hidden="true" />
                <span>
                  {authDialogServer.authMode === "oauth"
                    ? `${authDialogServer.vendor} OAuth will be linked and referenced by a session token.`
                    : "Paste a bearer token for this MCP server. The runtime will attach Authorization automatically."}
                </span>
              </div>

              {authDialogServer.authMode === "bearer" && (
                <label className="field-control">
                  <span>Bearer token</span>
                  <input
                    aria-label="Bearer token"
                    type="password"
                    value={serverTokenDraft}
                    placeholder="Minimum 8 characters"
                    onChange={(event) => setServerTokenDraft(event.target.value)}
                    minLength={8}
                    required
                  />
                </label>
              )}

              <div className="dialog-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => {
                    setAuthDialogServerId(null);
                    setPendingServerStatus(null);
                    setServerTokenDraft("");
                  }}
                >
                  Cancel
                </button>
                <button
                  className="primary-button"
                  type="button"
                  disabled={!canConnectServerCredential}
                  onClick={() => connectServerCredential(authDialogServer)}
                >
                  {authDialogServer.authMode === "oauth" ? "Authorize server" : "Store token"}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
