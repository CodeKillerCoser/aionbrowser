# Sidepanel UI + Markdown Design

**Goal**

Refresh the Browser ACP sidepanel to feel lighter and more modern, and render message bubble text as Markdown with inline code, fenced code blocks, and syntax highlighting.

**Approach**

Keep the existing sidepanel information architecture and session flow intact, but replace the current plain paragraph rendering with a dedicated Markdown message renderer. Use `react-markdown` with `remark-gfm` and `rehype-highlight` so assistant and user messages can display rich formatting safely inside the existing transcript pipeline.

For the visual refresh, preserve the two-column layout but shift the style system toward a cleaner, airier look: softer neutrals, brighter surfaces, lighter borders, smaller shadows, better spacing rhythm, and calmer emphasis states. The transcript should remain the visual center, with more readable bubbles and code blocks that look intentionally designed rather than debug-oriented.

**Key Decisions**

- Use `react-markdown + remark-gfm + rehype-highlight` for rendering.
- Render Markdown for all text message parts, so user-entered Markdown and assistant Markdown behave consistently.
- Keep the existing transcript data model; do not change session event aggregation.
- Keep the current sidepanel structure, but refine styling rather than redesigning layout architecture.

**Testing**

- Add a focused renderer test that proves headings, inline code, fenced code blocks, and syntax classes render.
- Keep existing app-level behavior tests green while updating styling and transcript rendering.
