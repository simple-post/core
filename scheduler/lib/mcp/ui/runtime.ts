import { getAppBaseUrl } from "@/lib/mcp/config";
import { WIDGET_ASSETS, type WidgetName } from "@/lib/mcp/ui/widget-assets";

export const WIDGET_RUNTIME_PATH = "/mcp-ui/runtime.js";
export const WIDGET_RUNTIME_TIMEOUT_MS = 10_000;

const WIDGET_RUNTIME_EXPORTS = {
  schedule: "mountScheduleWidget",
  "post-preview": "mountPostPreviewWidget",
} as const satisfies Record<WidgetName, string>;

export function isWidgetName(value: string | null): value is WidgetName {
  return value !== null && Object.hasOwn(WIDGET_ASSETS, value);
}

export function widgetRuntimeScript(name: WidgetName, mountId: string): string {
  const baseUrl = getAppBaseUrl();
  const assets = WIDGET_ASSETS[name];
  const scriptUrl = new URL(`/mcp-widgets/${assets.script}`, `${baseUrl}/`).toString();
  const stylesheetUrl = new URL(`/mcp-widgets/${assets.stylesheet}`, `${baseUrl}/`).toString();
  const stylesheetId = `simplepost-widget-styles-${name}`;
  const exportName = WIDGET_RUNTIME_EXPORTS[name];

  return `const mountId = ${JSON.stringify(mountId)};
const runtimeStateKey = "__simplepostRuntimeMount";

function assertCurrentMount() {
  if (window[runtimeStateKey] !== mountId) {
    throw new Error("This SimplePost widget mount has been superseded.");
  }
}

async function loadStylesheet() {
  const stylesheetUrl = ${JSON.stringify(stylesheetUrl)};
  const stylesheetId = ${JSON.stringify(stylesheetId)};
  const existing = document.getElementById(stylesheetId);
  if (existing instanceof HTMLLinkElement && existing.href === stylesheetUrl) return;
  existing?.remove();

  await new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.id = stylesheetId;
    link.rel = "stylesheet";
    link.href = stylesheetUrl;
    link.addEventListener("load", resolve, { once: true });
    link.addEventListener("error", () => reject(new Error("Unable to load SimplePost widget styles.")), {
      once: true,
    });
    document.head.appendChild(link);
  });
}

try {
  assertCurrentMount();
  await loadStylesheet();
  assertCurrentMount();
  const runtime = await import(${JSON.stringify(scriptUrl)});
  assertCurrentMount();
  const mount = runtime[${JSON.stringify(exportName)}];
  if (typeof mount !== "function") {
    throw new Error("The SimplePost widget runtime is missing its mount function.");
  }
  await mount();
  window.dispatchEvent(new CustomEvent("simplepost:runtime-ready", { detail: { mount: mountId } }));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  window.dispatchEvent(
    new CustomEvent("simplepost:runtime-error", { detail: { mount: mountId, message } }),
  );
  throw error;
}
`;
}
