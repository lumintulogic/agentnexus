# Product Requirement Document (PRD)

## Project: AgentNexus
**Version:** 1.0  
**Author:** AI Collaborator & Founder Core Team  
**Status:** Ready for Implementation  

---

## 1. Executive Summary & Vision
AgentNexus is a consumer-facing, model-agnostic Web Progressive Web Application (PWA) that acts as the "App Store and Operating System" layer for the Model Context Protocol (MCP) ecosystem. 

While the modern web is splitting into human-visual layers and machine-readable data layers (e.g., `llms.txt`), AgentNexus captures the **Action Layer**. It abstracts complex command-line infrastructure into a true **one-click installation browser GUI**, allowing non-technical consumers to instantly link their preferred LLM models to modular, visual-free backend services.

---

## 2. Core Architectural Pillars
To achieve immediate development velocity, the architecture relies on three rigid separations of concern:
1. **The Model Layer (Agnostic):** The frontend web client handles user state and prompts, routing them to the user’s API/Model provider of choice (Anthropic, OpenAI, local models via Ollama, etc.).
2. **The Connection Layer (AgentNexus Engine):** A browser-native orchestrator that maintains active client connections to MCP servers, maps capability schemas dynamically, and handles user authentication seamlessly.
3. **The Logic Layer (MCP Registry):** A centralized marketplace directory where developers publish pure functional backends using standard MCP specifications over stdio, HTTP/SSE, or WebSockets.

---

## 3. Epics & Functional Requirements

### Epic 1: One-Click Marketplace Dashboard (The Web GUI)
*   **Req 1.1:** The PWA must host a visual registry matrix where users can browse cataloged MCP servers (e.g., GitHub, Google Workspace, Postgres Tools).
*   **Req 1.2:** Clicking "Install" must automatically pull the server's standardized JSON-RPC capability schema directly inside the browser environment without requiring local terminal executions (`npx`, `uvx`, or CLI utilities).
*   **Req 1.3:** The UI must display active server status toggles, allowing users to hot-swap or deactivate specific backend integrations instantly during a live chat session.

### Epic 2: Unified Authentication & Token Management
*   **Req 2.1:** System must provide an abstracted OAuth and Bearer Token handshake layer directly inside the web interface.
*   **Req 2.2:** When a user installs a secure server (e.g., a Google Drive file manipulator), the system must securely handle the browser redirect, intercept the callback token, and store it encrypted in the client session storage.
*   **Req 2.3:** The system must automatically append required authentication headers (`Authorization: Bearer <token>`) to outgoing JSON-RPC requests to the respective MCP endpoints without exposing raw keys in the chat prompt layout.

### Epic 3: Dynamic Capability Mapping & Execution Engine
*   **Req 3.1:** Upon server connection, the engine must trigger an automatic capability handshake (`ListToolsAsync`) to read the server's exposed endpoints.
*   **Req 3.2:** The orchestrator must dynamically convert these schemas into structural system prompts and `AITool` definitions compatible with the user’s selected LLM context window.
*   **Req 3.3:** When the LLM emits a tool call intent, the engine must intercept the JSON argument payload, execute the network request to the remote or local MCP worker, and safely pipeline the raw extraction/manipulation results back to the LLM context for user-facing synthesis.

---

## 4. Technical Stack & Initial Boilerplate Guidance
To maintain maximum deployment velocity, the initial setup should stick to a clean, decoupled TypeScript stack:

*   **Frontend PWA:** React / Vite (Fast build time, native service-worker configuration for desktop/mobile shortcuts).
*   **State & Orchestration:** TypeScript implementation of the official `@modelcontextprotocol/sdk` configured to manage transport mechanisms over Server-Sent Events (SSE) and WebSockets natively in the browser.
*   **Database/Storage:** Supabase or Firebase for rapid consumer profile authentication, encrypted user-token storage, and indexing the MCP server marketplace directory metadata.

---

## 5. Next Steps for Immediate Development
To start building right away, execute the following milestones sequentially:
1. **Milestone 1:** Initialize the Vite-React repository and set up the layout structure for the twin-panel view: Left panel (Marketplace/Active Servers Manager) and Right panel (Model-Agnostic Chat Playground).
2. **Milestone 2:** Build a local mock-MCP server connection over WebSockets to test the dynamic `ListTools` mapping routine into an open-source LLM context.
3. **Milestone 3:** Wire up the initial unified authentication mock to ensure token persistence works seamlessly inside the web routing layer.