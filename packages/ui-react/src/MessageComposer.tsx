import { useEffect, useRef, useState } from "react";
import type { AgentAuthStatus, AuthMethodSummary, ModelState } from "@browser-acp/shared-types";
import { getComposerTextareaSize } from "./composerAutosize";

export function MessageComposer({
  value,
  disabled,
  isBusy,
  models,
  modelBusy = false,
  authStatus,
  authBusy = false,
  canRequestModels = false,
  onChange,
  onSubmit,
  onModelChange,
  onRequestModels,
  onAuthenticateAgent,
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
  authStatus?: AgentAuthStatus | null;
  authBusy?: boolean;
  canRequestModels?: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onModelChange?: (modelId: string) => void;
  onRequestModels?: () => void;
  onAuthenticateAgent?: (methodId?: string, env?: Record<string, string>) => void;
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
              authStatus={authStatus}
              authBusy={authBusy}
              canRequestModels={canRequestModels}
              onModelChange={onModelChange}
              onRequestModels={onRequestModels}
              onAuthenticateAgent={onAuthenticateAgent}
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
  authStatus,
  authBusy,
  canRequestModels,
  onModelChange,
  onRequestModels,
  onAuthenticateAgent,
  onModelSelectorLog,
}: {
  models?: ModelState | null;
  busy: boolean;
  authStatus?: AgentAuthStatus | null;
  authBusy: boolean;
  canRequestModels: boolean;
  onModelChange?: (modelId: string) => void;
  onRequestModels?: () => void;
  onAuthenticateAgent?: (methodId?: string, env?: Record<string, string>) => void;
  onModelSelectorLog?: (message: string, details?: Record<string, unknown>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [credentialMethod, setCredentialMethod] = useState<AuthMethodSummary | null>(null);
  const popoverRootRef = useRef<HTMLDivElement | null>(null);
  const availableModels = models?.availableModels ?? [];
  const currentModel = availableModels.find((model) => model.modelId === models?.currentModelId);
  const isLoadingModels = busy && (!models || availableModels.length === 0);
  const requiresLogin = authStatus?.state === "unauthenticated";
  const authMethods = authStatus?.methods ?? [];

  function closePopover(reason: string, details: Record<string, unknown> = {}) {
    setOpen(false);
    onModelSelectorLog?.("model selector dismissed", {
      reason,
      ...details,
    });
  }

  function closeCredentialDialog() {
    setCredentialMethod(null);
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

  if (requiresLogin) {
    if (!onAuthenticateAgent) {
      return null;
    }

    return (
      <div className="browser-acp-model-selector" ref={popoverRootRef}>
        <button
          type="button"
          className="browser-acp-model-selector-button"
          aria-label={authBusy ? "Agent 登录中" : "选择登录方式"}
          aria-haspopup={authMethods.length > 0 ? "dialog" : undefined}
          aria-expanded={authMethods.length > 0 ? open : undefined}
          disabled={authBusy}
          onClick={() => {
            if (authMethods.length === 0) {
              onAuthenticateAgent();
              return;
            }
            const nextOpen = !open;
            setOpen(nextOpen);
            onModelSelectorLog?.(nextOpen ? "auth method selector opened" : "model selector dismissed", {
              reason: "button",
              methodCount: authMethods.length,
            });
          }}
        >
          {authBusy ? <span className="browser-acp-model-selector-spinner" aria-hidden="true" /> : null}
          <span className="browser-acp-model-selector-label">{authBusy ? "登录中" : "登录"}</span>
          {authMethods.length > 0 ? (
            <span className="browser-acp-model-selector-chevron" aria-hidden="true">
              {open ? "▴" : "▾"}
            </span>
          ) : null}
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
            <div className="browser-acp-model-selector-popover" role="dialog" aria-label="登录方式">
              <div className="browser-acp-model-selector-options" role="list" aria-label="可用登录方式">
                {authMethods.map((method) => (
                  <AuthMethodOption
                    key={method.id}
                    method={method}
                    onAuthenticate={(methodId) => {
                      closePopover("auth-method", {
                        methodId,
                      });
                      onAuthenticateAgent(methodId);
                    }}
                    onRequestCredentials={(selectedMethod) => {
                      closePopover("env-auth-method", {
                        methodId: selectedMethod.id,
                      });
                      setCredentialMethod(selectedMethod);
                    }}
                  />
                ))}
              </div>
            </div>
          </>
        ) : null}
        {credentialMethod ? (
          <CredentialDialog
            method={credentialMethod}
            busy={authBusy}
            onCancel={closeCredentialDialog}
            onSubmit={(env) => {
              const methodId = credentialMethod.id;
              closeCredentialDialog();
              onAuthenticateAgent(methodId, env);
            }}
          />
        ) : null}
      </div>
    );
  }

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

function AuthMethodOption({
  method,
  onAuthenticate,
  onRequestCredentials,
}: {
  method: AuthMethodSummary;
  onAuthenticate: (methodId: string) => void;
  onRequestCredentials: (method: AuthMethodSummary) => void;
}) {
  const title = method.name ?? method.id;
  const description = getAuthMethodDescription(method);
  const content = (
    <>
      <span>{title}</span>
      {description ? <small>{description}</small> : null}
      {method.type === "env_var" && method.vars?.length ? (
        <small className="browser-acp-model-selector-code-list">
          {method.vars.map((variable) => variable.name).join(", ")}
        </small>
      ) : null}
    </>
  );

  if (method.type === "env_var") {
    return (
      <button
        type="button"
        className="browser-acp-model-selector-option"
        aria-label={title}
        onClick={() => onRequestCredentials(method)}
      >
        {content}
      </button>
    );
  }

  if (method.type !== "agent") {
    return (
      <div className="browser-acp-model-selector-option browser-acp-model-selector-option-static" role="listitem">
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      className="browser-acp-model-selector-option"
      aria-label={title}
      onClick={() => onAuthenticate(method.id)}
    >
      {content}
    </button>
  );
}

function CredentialDialog({
  method,
  busy,
  onCancel,
  onSubmit,
}: {
  method: AuthMethodSummary;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (env: Record<string, string>) => void;
}) {
  const variables = method.vars ?? [];
  const [values, setValues] = useState<Record<string, string>>({});
  const [customVariables, setCustomVariables] = useState<Array<{ id: string; name: string; value: string }>>([]);
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const firstInputRef = useRef<HTMLInputElement | null>(null);
  const title = method.name ?? "填写凭证";
  const missingRequiredVariables = variables.filter((variable) => !variable.optional && !values[variable.name]?.trim());
  const incompleteCustomVariables = customVariables.filter((variable) => {
    const hasName = variable.name.trim().length > 0;
    const hasValue = variable.value.trim().length > 0;
    return hasName !== hasValue;
  });

  useEffect(() => {
    firstInputRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCancel();
      }
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [onCancel]);

  function submit() {
    setAttemptedSubmit(true);
    if (missingRequiredVariables.length > 0 || incompleteCustomVariables.length > 0) {
      return;
    }

    const envEntries = [
      ...variables
        .map((variable) => [variable.name, values[variable.name]?.trim() ?? ""] as const)
        .filter(([, value]) => value.length > 0),
      ...customVariables
        .map((variable) => [variable.name.trim(), variable.value.trim()] as const)
        .filter(([name, value]) => name.length > 0 && value.length > 0),
    ];
    const env = Object.fromEntries(envEntries);
    onSubmit(env);
  }

  return (
    <>
      <div className="browser-acp-credential-backdrop" aria-hidden="true" onMouseDown={onCancel} />
      <div className="browser-acp-credential-dialog" role="dialog" aria-modal="true" aria-labelledby="browser-acp-credential-title">
        <div className="browser-acp-credential-header">
          <div>
            <h2 id="browser-acp-credential-title">{title}</h2>
            {method.description ? <p>{method.description}</p> : null}
          </div>
          <button
            type="button"
            className="browser-acp-credential-close"
            aria-label="关闭"
            onClick={onCancel}
            disabled={busy}
          >
            ×
          </button>
        </div>
        <div className="browser-acp-credential-fields">
          {variables.map((variable, index) => {
            const inputId = `browser-acp-credential-${method.id}-${variable.name}`;
            const hasError = attemptedSubmit && !variable.optional && !values[variable.name]?.trim();
            return (
              <label
                key={variable.name}
                className="browser-acp-credential-field browser-acp-credential-fixed-field"
                htmlFor={inputId}
              >
                <span>
                  {variable.label ?? variable.name}
                  {variable.optional ? <small>可选</small> : null}
                </span>
                <input
                  ref={index === 0 ? firstInputRef : undefined}
                  id={inputId}
                  type={variable.secret === false ? "text" : "password"}
                  value={values[variable.name] ?? ""}
                  aria-invalid={hasError}
                  placeholder={variable.name}
                  onChange={(event) => {
                    setValues((current) => ({
                      ...current,
                      [variable.name]: event.target.value,
                    }));
                  }}
                />
                {hasError ? <small className="browser-acp-credential-error">请填写此项</small> : null}
              </label>
            );
          })}
          <button
            type="button"
            className="browser-acp-credential-add"
            aria-label="添加环境变量"
            title="添加环境变量"
            onClick={() => {
              setCustomVariables((current) => [
                ...current,
                {
                  id: `${Date.now()}-${current.length}`,
                  name: "",
                  value: "",
                },
              ]);
            }}
            disabled={busy}
          >
            <span aria-hidden="true">+</span>
            <span>添加变量</span>
          </button>
          {customVariables.map((variable, index) => {
            const nameInputId = `browser-acp-credential-custom-name-${variable.id}`;
            const valueInputId = `browser-acp-credential-custom-value-${variable.id}`;
            const nameMissing = attemptedSubmit && !variable.name.trim() && variable.value.trim().length > 0;
            const valueMissing = attemptedSubmit && variable.name.trim().length > 0 && !variable.value.trim();
            return (
              <div key={variable.id} className="browser-acp-credential-custom-field">
                <label className="browser-acp-credential-field" htmlFor={nameInputId}>
                  <span>变量名 {index + 1}</span>
                  <input
                    id={nameInputId}
                    type="text"
                    value={variable.name}
                    aria-invalid={nameMissing}
                    placeholder="例如 GOOGLE_API_KEY"
                    onChange={(event) => {
                      const nextName = event.target.value;
                      setCustomVariables((current) =>
                        current.map((entry) => entry.id === variable.id ? { ...entry, name: nextName } : entry),
                      );
                    }}
                  />
                  {nameMissing ? <small className="browser-acp-credential-error">请填写变量名</small> : null}
                </label>
                <label className="browser-acp-credential-field" htmlFor={valueInputId}>
                  <span>变量值 {index + 1}</span>
                  <input
                    id={valueInputId}
                    type="password"
                    value={variable.value}
                    aria-invalid={valueMissing}
                    placeholder="输入变量值"
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setCustomVariables((current) =>
                        current.map((entry) => entry.id === variable.id ? { ...entry, value: nextValue } : entry),
                      );
                    }}
                  />
                  {valueMissing ? <small className="browser-acp-credential-error">请填写变量值</small> : null}
                </label>
                <button
                  type="button"
                  className="browser-acp-credential-remove"
                  aria-label={`删除环境变量 ${index + 1}`}
                  onClick={() => {
                    setCustomVariables((current) => current.filter((entry) => entry.id !== variable.id));
                  }}
                  disabled={busy}
                >
                  删除
                </button>
              </div>
            );
          })}
        </div>
        {method.link ? (
          <a className="browser-acp-credential-link" href={method.link} target="_blank" rel="noreferrer">
            获取凭证
          </a>
        ) : null}
        <div className="browser-acp-credential-actions">
          <button type="button" className="browser-acp-credential-secondary" onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button type="button" className="browser-acp-credential-primary" onClick={submit} disabled={busy}>
            {busy ? "提交中" : "确认登录"}
          </button>
        </div>
      </div>
    </>
  );
}

function getAuthMethodDescription(method: AuthMethodSummary): string | null {
  if (method.description) {
    return method.description;
  }
  if (method.type === "env_var") {
    return "需要在 Agent 环境变量中配置凭证。";
  }
  if (method.type === "terminal") {
    return "需要在终端中完成交互式登录。";
  }
  return null;
}
