import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { SessionEvent } from "@browser-acp/shared-types";
import {
  filterOptimisticPromptsByStartedTurns,
  filterSubmittingPermissionIdsByResolvedEvents,
  type OptimisticPrompt,
} from "@browser-acp/client-core";

export function useTranscriptHousekeeping({
  currentEvents,
  selectedSessionId,
  setOptimisticPrompts,
  setSubmittingPermissionIds,
}: {
  currentEvents: SessionEvent[];
  selectedSessionId: string;
  setOptimisticPrompts: Dispatch<SetStateAction<OptimisticPrompt[]>>;
  setSubmittingPermissionIds: Dispatch<SetStateAction<string[]>>;
}) {
  useEffect(() => {
    setOptimisticPrompts((current) =>
      filterOptimisticPromptsByStartedTurns(current, selectedSessionId, currentEvents),
    );
  }, [currentEvents, selectedSessionId, setOptimisticPrompts]);

  useEffect(() => {
    setSubmittingPermissionIds((current) => filterSubmittingPermissionIdsByResolvedEvents(current, currentEvents));
  }, [currentEvents, setSubmittingPermissionIds]);
}
