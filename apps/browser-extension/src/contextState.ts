export function resolveSelectionText({
  previousSelectionText,
  nextSelectionText,
  hasFocus,
}: {
  previousSelectionText: string;
  nextSelectionText: string;
  hasFocus: boolean;
}): string {
  if (nextSelectionText.length > 0) {
    return nextSelectionText;
  }

  if (!hasFocus && previousSelectionText.length > 0) {
    return previousSelectionText;
  }

  return "";
}
