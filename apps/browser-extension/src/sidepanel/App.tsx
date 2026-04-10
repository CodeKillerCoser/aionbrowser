import { BrowserAcpPanel } from "../ui/sidepanel/BrowserAcpPanel";
import { createChromeBridge } from "./bridge";

export function App() {
  return (
    <div className="browser-acp-panel-root">
      <BrowserAcpPanel bridge={createChromeBridge()} />
    </div>
  );
}
