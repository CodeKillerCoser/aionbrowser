import { useEffect, useState } from "react";
import type {
  BrowserContextBundle,
  ConversationSummary,
  NativeHostBootstrapResponse,
  ResolvedAgent,
} from "@browser-acp/shared-types";
import type { BackgroundDebugState } from "../../../messages";
import type { BrowserAcpBridge } from "../../../sidepanel/contracts";

function keepNewerContext(
  current: BrowserContextBundle | null,
  next: BrowserContextBundle,
): BrowserContextBundle {
  if (!current) {
    return next;
  }

  return Date.parse(next.capturedAt) >= Date.parse(current.capturedAt) ? next : current;
}

export function usePanelBootstrap(
  bridge: BrowserAcpBridge,
  recordPanelLog: (message: string, details?: unknown, scope?: string) => void,
) {
  const [bootstrap, setBootstrap] = useState<NativeHostBootstrapResponse | null>(null);
  const [agents, setAgents] = useState<ResolvedAgent[]>([]);
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
        const nextBootstrap = await bridge.ensureDaemon();
        const [nextAgents, nextSessions, nextContext, nextDebugState] = await Promise.all([
          bridge.listAgents(nextBootstrap),
          bridge.listSessions(nextBootstrap),
          bridge.getActiveContext(),
          bridge.getDebugState(),
        ]);

        if (cancelled) {
          return;
        }

        setBootstrap(nextBootstrap);
        setAgents(nextAgents);
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
        const message = loadError instanceof Error ? loadError.message : String(loadError);
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
    bootstrap,
    agents,
    sessions,
    context,
    selectedAgentId,
    selectedSessionId,
    error,
    debugState,
    setContext,
    setSessions,
    setSelectedAgentId,
    setSelectedSessionId,
    setError,
    setDebugState,
  };
}
