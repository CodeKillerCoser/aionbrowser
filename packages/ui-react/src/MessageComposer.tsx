import { useEffect, useRef, useState } from "react";
import type { ModelState } from "@browser-acp/shared-types";
import { getComposerTextareaSize } from "./composerAutosize";

export function MessageComposer({
  value,
  disabled,
  isBusy,
  models,
  modelBusy = false,
  canRequestModels = false,
  onChange,
  onSubmit,
  onModelChange,
  onRequestModels,
  onModelSelectorLog,
  placeholder = "询问当前上下文，或直接输入任务...",
  idleHint = "Enter 发送 · Shift+Enter 换行",
  busyHint = "正在生成回复…",
}: {
  value: string;
  disabled: boolean;
  isBusy: boolean;
  models?: ModelState | null;
  modelBusy?: boolean;
  canRequestModels?: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onModelChange?: (modelId: string) => void;
  onRequestModels?: () => void;
  onModelSelectorLog?: (message: string, details?: Record<string, unknown>) => void;
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
          <div className="browser-acp-composer-footer-left">
            <ModelSelector
              models={models}
              busy={modelBusy}
              canRequestModels={canRequestModels}
              onModelChange={onModelChange}
              onRequestModels={onRequestModels}
              onModelSelectorLog={onModelSelectorLog}
            />
            <span className="browser-acp-composer-hint">{isBusy ? busyHint : idleHint}</span>
          </div>
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

function ModelSelector({
  models,
  busy,
  canRequestModels,
  onModelChange,
  onRequestModels,
  onModelSelectorLog,
}: {
  models?: ModelState | null;
  busy: boolean;
  canRequestModels: boolean;
  onModelChange?: (modelId: string) => void;
  onRequestModels?: () => void;
  onModelSelectorLog?: (message: string, details?: Record<string, unknown>) => void;
}) {
  const [open, setOpen] = useState(false);
  const popoverRootRef = useRef<HTMLDivElement | null>(null);
  const availableModels = models?.availableModels ?? [];
  const currentModel = availableModels.find((model) => model.modelId === models?.currentModelId);
  const isLoadingModels = busy && (!models || availableModels.length === 0);

  function closePopover(reason: string, details: Record<string, unknown> = {}) {
    setOpen(false);
    onModelSelectorLog?.("model selector dismissed", {
      reason,
      ...details,
    });
  }

  useEffect(() => {
    if (!open) {
      return;
    }

    function isEventInsideModelSelector(event: Event): boolean {
      const root = popoverRootRef.current;
      const target = event.target;
      return Boolean(root && target instanceof Node && root.contains(target));
    }

    function handleDismissPointer(event: Event) {
      if (isEventInsideModelSelector(event)) {
        return;
      }

      closePopover("outside-pointer", {
        eventType: event.type,
      });
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        closePopover("escape");
      }
    }

    window.addEventListener("pointerdown", handleDismissPointer, true);
    window.addEventListener("mousedown", handleDismissPointer, true);
    window.addEventListener("click", handleDismissPointer, true);
    window.addEventListener("touchstart", handleDismissPointer, true);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", handleDismissPointer, true);
      window.removeEventListener("mousedown", handleDismissPointer, true);
      window.removeEventListener("click", handleDismissPointer, true);
      window.removeEventListener("touchstart", handleDismissPointer, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open]);

  if (!models || availableModels.length === 0) {
    if (!canRequestModels || !onRequestModels) {
      return null;
    }

    return (
      <div className="browser-acp-model-selector">
        <button
          type="button"
          className="browser-acp-model-selector-button"
          aria-label={isLoadingModels ? "模型列表加载中" : "获取模型列表"}
          disabled={busy}
          onClick={onRequestModels}
        >
          {isLoadingModels ? <span className="browser-acp-model-selector-spinner" aria-hidden="true" /> : null}
          <span className="browser-acp-model-selector-label">{isLoadingModels ? "加载中" : "模型"}</span>
          {!isLoadingModels ? (
            <span className="browser-acp-model-selector-chevron" aria-hidden="true">
              ▾
            </span>
          ) : null}
        </button>
      </div>
    );
  }

  const currentLabel = currentModel?.name ?? models.currentModelId;

  return (
    <div className="browser-acp-model-selector" ref={popoverRootRef}>
      <button
        type="button"
        className="browser-acp-model-selector-button"
        aria-label={`选择模型：${currentLabel}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={busy || !onModelChange}
        onClick={() => {
          const nextOpen = !open;
          setOpen(nextOpen);
          onModelSelectorLog?.(nextOpen ? "model selector opened" : "model selector dismissed", {
            reason: "button",
            modelCount: availableModels.length,
            currentModelId: models.currentModelId,
          });
        }}
      >
        {busy ? <span className="browser-acp-model-selector-spinner" aria-hidden="true" /> : null}
        <span className="browser-acp-model-selector-label">{currentLabel}</span>
        <span className="browser-acp-model-selector-chevron" aria-hidden="true">
          {open ? "▴" : "▾"}
        </span>
      </button>
      {open ? (
        <>
          <div
            className="browser-acp-model-selector-backdrop"
            aria-hidden="true"
            onMouseDown={() => closePopover("backdrop")}
            onClick={() => closePopover("backdrop")}
            onTouchStart={() => closePopover("backdrop")}
          />
          <div className="browser-acp-model-selector-popover" role="dialog" aria-label="模型列表">
            <div className="browser-acp-model-selector-options" role="listbox" aria-label="可选模型">
              {availableModels.map((model) => (
                <button
                  key={model.modelId}
                  type="button"
                  role="option"
                  aria-selected={model.modelId === models.currentModelId}
                  className="browser-acp-model-selector-option"
                  onClick={() => {
                    closePopover("select", {
                      modelId: model.modelId,
                    });
                    if (model.modelId !== models.currentModelId) {
                      onModelChange?.(model.modelId);
                    }
                  }}
                >
                  <span>{model.name}</span>
                  {model.description ? <small>{model.description}</small> : null}
                </button>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
