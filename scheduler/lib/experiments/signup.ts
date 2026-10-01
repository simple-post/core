import { assignmentKey, cookieValue, EXPERIMENT_COOKIE, isOptedOut, verifyAssignment } from "./contract";
export function signupExperiment(headers?: Headers | null) {
  if (!headers || isOptedOut(headers)) return null;
  const assignment = verifyAssignment(
    cookieValue(headers.get("cookie") || "", EXPERIMENT_COOKIE),
    process.env.HOMEPAGE_EXPERIMENT_SECRET || "",
  );
  return assignment
    ? {
        version: 1,
        assignmentId: assignmentKey(assignment),
        experimentId: assignment.experimentId,
        variant: assignment.variant,
      }
    : null;
}
