import type { PageContextPayload } from "./messages";

export function mergeFramePageContexts(payloads: PageContextPayload[]): {
  selectionText: string;
  summaryMarkdown: string;
  hasFocus: boolean;
} {
  const normalizedPayloads = payloads.map((payload) => ({
    ...payload,
    selectionText: payload.selectionText.trim(),
    summaryMarkdown: payload.summaryMarkdown.trim(),
  }));

  const hasFocus = normalizedPayloads.some((payload) => payload.hasFocus);
  const selectionSource =
    normalizedPayloads.find((payload) => payload.hasFocus && payload.selectionText.length > 0) ??
    normalizedPayloads.find((payload) => payload.selectionText.length > 0);
  const summarySource =
    normalizedPayloads.find((payload) => payload.hasFocus && payload.summaryMarkdown.length > 0) ??
    normalizedPayloads.find((payload) => payload.summaryMarkdown.length > 0);

  return {
    selectionText: selectionSource?.selectionText ?? "",
    summaryMarkdown: summarySource?.summaryMarkdown ?? "",
    hasFocus,
  };
}
