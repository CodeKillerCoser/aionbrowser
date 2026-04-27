export type ComposerTextareaOverflow = "auto" | "hidden";

export function getComposerTextareaSize({
  lineHeight,
  verticalInset,
  scrollHeight,
  maxLines = 10,
}: {
  lineHeight: number;
  verticalInset: number;
  scrollHeight: number;
  maxLines?: number;
}): {
  height: number;
  overflowY: ComposerTextareaOverflow;
} {
  const minHeight = lineHeight + verticalInset;
  const maxHeight = lineHeight * maxLines + verticalInset;
  const height = Math.min(maxHeight, Math.max(minHeight, scrollHeight));

  return {
    height,
    overflowY: scrollHeight > maxHeight ? "auto" : "hidden",
  };
}
