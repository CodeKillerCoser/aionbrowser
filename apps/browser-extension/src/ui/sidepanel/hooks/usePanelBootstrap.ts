import { useEffect, useState } from "react";
import type {
  AgentSpec,
  BrowserContextBundle,
  ConversationSummary,
  ResolvedAgent,
} from "@browser-acp/shared-types";
import { getErrorMessage, keepNewerContext } from "@browser-acp/client-core";
import type { BackgroundDebugState } from "../../../messages";
import type { BrowserAcpBridge } from "../../../host-api/agentConsoleHost";

export function usePanelBootstrap(
  bridge: BrowserAcpBridge,
  recordPanelLog: (message: string, details?: unknown, scope?: string) => void,
) {
  const [hostReady, setHostReady] = useState(false);
  const [agents, setAgents] = useState<ResolvedAgent[]>([]);
  const [agentSpecs, setAgentSpecs] = useState<AgentSpec[]>([]);
  const [sessions, setSessions] = useState<ConversationSummary[]>([]);
  const [context, setContext] = useState<BrowserContextBundle | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [selectedSessionId, setSelectedSessionId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [debugState, setDebugState] = useState<BackgroundDebugState | null>(null);

  useEffect(() => {
    let cancelled = false;
    recordPanelLog("panel bootstrap started");

    void (async () => {
      try {
        await bridge.ensureReady();
        const [nextAgents, nextAgentSpecs, nextSessions, nextContext, nextDebugState] = await Promise.all([
          bridge.listAgents(),
          bridge.listAgentSpecs(),
          bridge.listSessions(),
          bridge.getActiveContext(),
          bridge.getDebugState(),
        ]);

        if (cancelled) {
          return;
        }

        setHostReady(true);
        setAgents(nextAgents);
        setAgentSpecs(nextAgentSpecs);
        setSessions(nextSessions);
        setContext((current) => keepNewerContext(current, nextContext));
        setDebugState(nextDebugState);
        setSelectedSessionId((current) => current || nextSessions[0]?.id || "");
        setSelectedAgentId((current) =>
          current ||
          nextSessions[0]?.agentId ||
          nextAgents.find((agent) => agent.status === "ready")?.id ||
          nextAgents[0]?.id ||
          "",
        );
        recordPanelLog("panel bootstrap completed", {
          agentCount: nextAgents.length,
          sessionCount: nextSessions.length,
        });
      } catch (loadError) {
        const message = getErrorMessage(loadError);
        setError(message);
        recordPanelLog("panel bootstrap failed", {
          error: message,
        });
        try {
          const nextDebugState = await bridge.getDebugState();
          if (!cancelled) {
            setDebugState(nextDebugState);
          }
        } catch {
          // Ignore diagnostics refresh failures.
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bridge]);

  return {
    hostReady,
    agents,
    agentSpecs,
    sessions,
    context,
    selectedAgentId,
    selectedSessionId,
    error,
    debugState,
    setContext,
    setSessions,
    setAgents,
    setAgentSpecs,
    setSelectedAgentId,
    setSelectedSessionId,
    setError,
    setDebugState,
  };
}
