import type { ReactNode } from "react";
export function ComposerColumns({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">{children}</div>;
}
