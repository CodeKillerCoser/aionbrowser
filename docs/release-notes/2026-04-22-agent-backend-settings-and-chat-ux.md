# Release Note: Agent Backend 配置化与对话体验优化

发布日期：2026-04-22

## 概览

本次更新将 Browser ACP 的 agent 接入方式从“自动发现本机 CLI”为主，调整为“通过设置页配置 Agent Backend”为主，同时保留对常见本机 ACP CLI 的扫描推荐能力。对话侧边栏也完成了一轮轻量化改造，提升消息发送即时反馈、工具/权限事件展示、输入框空间利用率和设置页可用性。

## 新增能力

- 新增 Agent Backend 配置体系：外部 agent 统一以 ACP agent 暴露给上层对话，session 与 agent 之间仍严格使用 ACP 协议交互。
- 新增 daemon 端 `/agent-specs` 与 `/agent-spec-candidates` 等配置接口，支持创建、更新、删除、列出 agent 配置，以及扫描可添加的本机内置候选。
- 新增 `agent-specs.json` 配置存储，支持原子写入、基础校验，并能修复部分异常截断的 JSON 数组配置。
- 新增设置页入口：用户可以在 sidepanel 中进入 Agent 配置页，手动填写名称、启动命令、启动参数和 icon，也可以从扫描结果中勾选添加。
- 新增内置 agent 候选扫描：默认扫描 Gemini、GitHub Copilot、Qoder、Codex、Claude 等常见 ACP 后端，并展示本机检测到的命令路径。
- 新增内置图标兜底：扫描候选和已配置 agent 会根据名称或启动命令匹配内置图标，也支持 URL 或上传图标。

## 对话体验优化

- 用户发送消息后立即上屏，不再等待 session 创建或 websocket 发送完成。
- 发送后立即显示 assistant loading 气泡，移除旧的 `Streaming…` 文案，改为轻量 loading 动画。
- 发送失败不回滚用户消息，也不恢复输入框内容；失败会作为 assistant 回复展示，例如 `发送失败：...`。
- 输入框底部提示和发送按钮合并为同一行，减少 composer 占用高度，释放更多对话区域空间。
- 点击输入框提示文本区域也会聚焦输入框，减少“点了没反应”的交互死区。
- 工具调用和权限请求以独立 system event row 展示，默认收起详情，仅在摘要行展示命令、状态和展开入口。
- 工具调用与权限请求的摘要去重，避免命令在标题和正文中重复展示。
- 思考类系统事件默认以更轻量的行内形式展示，避免占用过多气泡空间。

## UI 与布局调整

- sidepanel 左侧 agent 区域改为图标列表，hover 可查看名称和本机路径。
- session 历史列表改为更轻量的纯标题列表，保留 hover 与选中态。
- 对话标题区域仅展示当前对话标题和 agent 名称，减少无效标题占用。
- 设置页采用独立页面式布局，左上角提供“返回对话”入口，避免与对话主界面混杂。
- Debug 入口稳定透出，不再只在启动瞬间短暂显示。
- 对话区域底部留白和滚动行为进行了修正，减少输入框遮挡最后一条消息的问题。

## 架构调整

- 引入 `AgentSpecStore` 管理 agent backend 配置。
- 引入 `AgentRegistry`，将配置化 agent 转换为上层统一可用的 `ResolvedAgent`。
- 引入 `RuntimeHost` 抽象，session manager 不再直接依赖固定 CLI 启动细节，为后续内置 runtime 或更多 backend 类型预留边界。
- 扩展 shared types，增加 `AgentSpec`、`ExternalAcpAgentSpec`、`AgentSpecCandidate`、`AgentIconSpec` 等类型。
- native host 启动 daemon 时会加载登录 shell 环境，提升对用户本机 CLI 路径的识别能力。

## 修复

- 修复设置页保存 agent 配置时 daemon 404/500 的链路问题。
- 修复 agent 候选扫描只显示命令、不显示本机实际路径的问题。
- 修复 debug 面板入口加载完成后消失的问题。
- 修复对话列表无法滚动的问题。
- 修复选中文本快捷菜单触发后无法灌入对话的若干时序问题。
- 修复消息列表底部空间不足导致最后内容被输入框遮挡的问题。

## 验证

本次更新已覆盖 daemon、native host、browser extension 的单元与集成测试，并完成生产构建验证。

- `pnpm --filter @browser-acp/browser-extension test -- --run tests/app.test.tsx`
- `pnpm --filter @browser-acp/browser-extension typecheck`
- `pnpm build`
- `pnpm test`

说明：构建仍会出现既有的 Vite 大 chunk warning，该 warning 不影响本次功能发布。
