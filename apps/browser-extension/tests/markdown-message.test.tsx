import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownMessage } from "../src/sidepanel/MarkdownMessage";

describe("MarkdownMessage", () => {
  it("renders markdown text with inline code, tables, and highlighted code blocks", () => {
    render(
      <MarkdownMessage>
        {`# Quick Start

Use \`pnpm test\` before shipping.

| Tool | Status |
| --- | --- |
| ACP | Ready |

\`\`\`ts
const answer = 42;
\`\`\`
`}
      </MarkdownMessage>,
    );

    expect(screen.getByRole("heading", { name: "Quick Start" })).toBeInTheDocument();
    expect(screen.getByText("pnpm test")).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();

    const codeBlock = document.querySelector("pre code");
    expect(codeBlock).not.toBeNull();
    expect(codeBlock?.className).toContain("hljs");
    expect(codeBlock).toHaveTextContent("const answer = 42;");
  });
});
