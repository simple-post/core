import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { BadRequestError, ConflictError } from "@/lib/utils/errors";

import type { Tx } from "./access";
import type { WorkspaceCommand } from "./contracts";

export async function saveWorkflow(
  tx: Tx,
  workspaceId: string,
  command: Extract<WorkspaceCommand, { action: "workflow" }>,
) {
  const current = await tx.teamState.findMany({
    where: { workspaceId },
    orderBy: [{ position: "asc" }, { id: "asc" }],
  });
  if (
    !isDeepStrictEqual(
      command.expected,
      current.map(({ id, name, position }) => ({ id, name, position })),
    )
  )
    throw new ConflictError("The workflow changed. Reload it before saving.");
  const editable = current.filter((state) => state.kind !== "approved");
  const byId = new Map(editable.map((state) => [state.id, state]));
  const kept = command.states.flatMap((state) => (state.id ? [state.id] : []));
  const names = command.states.map((state) => state.name.toLowerCase());
  if (new Set(kept).size !== kept.length || kept.some((id) => !byId.has(id)))
    throw new BadRequestError("The workflow contains an unavailable state.");
  if (new Set(names).size !== names.length || names.includes("approved"))
    throw new ConflictError("Use a unique name for each state. Approved is the protected final state.");
  const removed = editable.filter((state) => !kept.includes(state.id));
  const removedIds = removed.map((state) => state.id);
  if (
    removed.some((state) => state.kind !== "custom") ||
    (removedIds.length > 0 && (await tx.teamPost.count({ where: { workspaceId, stateId: { in: removedIds } } })))
  )
    throw new ConflictError("Only unused custom states can be removed.");
  await tx.teamState.deleteMany({ where: { workspaceId, id: { in: removedIds } } });
  // Stage changed names so a swap never violates the unique name constraint.
  for (const state of command.states) {
    if (state.id && byId.get(state.id)?.name !== state.name)
      await tx.teamState.update({ where: { id: state.id }, data: { name: "~".repeat(81) + randomUUID() } });
  }
  for (const [position, state] of command.states.entries()) {
    await (state.id
      ? tx.teamState.update({ where: { id: state.id }, data: { name: state.name, position } })
      : tx.teamState.create({ data: { name: state.name, position, workspaceId, kind: "custom" } }));
  }
}
