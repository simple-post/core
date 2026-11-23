"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth/auth-client";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";

type SetupReminderState = { available: boolean; pending: boolean };

async function requestPreference(method: "GET" | "POST" | "DELETE"): Promise<SetupReminderState> {
  const response = await fetch("/api/v1/setup-reminder", { method, cache: "no-store" });
  if (!response.ok) throw new Error("Could not save setup reminder preference");
  return (await response.json()) as SetupReminderState;
}

export function SetupReminderPreference({ pendingOnly = false }: { pendingOnly?: boolean }) {
  const { copy } = useUiCopy();
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const queryKey = ["setup-reminder", session?.user.id];
  const { data } = useQuery({
    queryKey,
    queryFn: () => requestPreference("GET"),
    enabled: Boolean(session?.user.id),
  });
  const save = useMutation({
    mutationFn: (method: "POST" | "DELETE") => requestPreference(method),
    onSuccess: (updated) => queryClient.setQueryData(queryKey, updated),
  });

  if (!data || (!data.pending && (pendingOnly || !data.available))) return null;
  return (
    <div>
      {data.pending && <p className="text-xs text-muted-foreground">{copy("Setup reminder scheduled.")}</p>}
      <Button
        type="button"
        variant="link"
        className="h-auto whitespace-normal px-0 text-start text-xs"
        disabled={save.isPending}
        onClick={() => save.mutate(data.pending ? "DELETE" : "POST")}>
        {data.pending
          ? copy("Cancel setup reminder")
          : copy("Email me once if I haven’t connected an account two days after signup.")}
      </Button>
      {save.isError && (
        <p role="alert" className="text-xs text-destructive">
          {copy("Could not save your preference. Please try again.")}
        </p>
      )}
    </div>
  );
}
