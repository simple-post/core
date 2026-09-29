import { createRoot } from "react-dom/client";

import { Workspace } from "./workspace-app";

export function mountPostEditorWidget() {
  const root = document.querySelector("#root");
  if (!root) throw new Error("SimplePost editor root is missing.");
  createRoot(root).render(<Workspace editorOnly />);
}
