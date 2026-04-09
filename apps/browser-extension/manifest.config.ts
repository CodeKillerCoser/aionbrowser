import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "Browser ACP",
  version: "0.1.0",
  description: "ACP browser reading companion for local coding agents",
  permissions: [
    "activeTab",
    "tabs",
    "storage",
    "scripting",
    "sidePanel",
    "nativeMessaging"
  ],
  host_permissions: [
    "http://127.0.0.1/*",
    "http://localhost/*",
    "<all_urls>"
  ],
  background: {
    service_worker: "src/background.ts",
    type: "module"
  },
  action: {
    default_title: "Open Browser ACP"
  },
  side_panel: {
    default_path: "sidepanel.html"
  },
  content_scripts: [
    {
      matches: [
        "<all_urls>"
      ],
      all_frames: true,
      match_about_blank: true,
      // @ts-expect-error Chrome supports this field for about:blank/srcdoc descendants.
      match_origin_as_fallback: true,
      js: [
        "src/content.ts"
      ],
      run_at: "document_idle"
    }
  ]
});
