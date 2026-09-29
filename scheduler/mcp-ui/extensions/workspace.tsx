import { createRoot } from "react-dom/client";

import { Workspace } from "./workspace-app";

export function mountWorkspaceWidget() {
  const root = document.querySelector("#root");
  if (!root) throw new Error("SimplePost workspace root is missing.");
  createRoot(root).render(<Workspace />);
}
