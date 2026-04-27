import { useEffect, useRef } from "react";
import { getComposerTextareaSize } from "./composerAutosize";

export function MessageComposer({
  value,
  disabled,
  isBusy,
  onChange,
  onSubmit,
  placeholder = "询问当前上下文，或直接输入任务...",
  idleHint = "Enter 发送 · Shift+Enter 换行",
  busyHint = "正在生成回复…",
}: {
  value: string;
  disabled: boolean;
  isBusy: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  idleHint?: string;
  busyHint?: string;
}) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) {
      return;
    }

    input.style.height = "0px";

    const computedStyle = window.getComputedStyle(input);
    const lineHeight = Number.parseFloat(computedStyle.lineHeight) || 24;
    const verticalInset = input.offsetHeight - input.clientHeight;
    const { height, overflowY } = getComposerTextareaSize({
      lineHeight,
      verticalInset,
      scrollHeight: input.scrollHeight,
    });

    input.style.height = `${height}px`;
    input.style.overflowY = overflowY;
  }, [value]);

  return (
    <div className="browser-acp-composer">
      <div className="browser-acp-composer-surface">
        <textarea
          ref={inputRef}
          className="browser-acp-composer-input"
          placeholder={placeholder}
          rows={1}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            const isComposing = "isComposing" in event.nativeEvent && event.nativeEvent.isComposing;
            if (event.key !== "Enter" || event.shiftKey || isComposing) {
              return;
            }

            event.preventDefault();
            onSubmit();
          }}
        />
        <div
          className="browser-acp-composer-footer"
          onMouseDown={(event) => {
            if ((event.target as HTMLElement).closest("button")) {
              return;
            }

            event.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <span className="browser-acp-composer-hint">{isBusy ? busyHint : idleHint}</span>
          <button
            type="button"
            className="browser-acp-composer-send"
            onClick={onSubmit}
            disabled={!value.trim() || disabled}
          >
            <span>发送</span>
            <span className="browser-acp-composer-shortcut" aria-hidden="true">
              ↵
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
