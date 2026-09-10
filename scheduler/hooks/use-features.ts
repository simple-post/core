"use client";

import { type Feature } from "@prisma/client";
import { useQuery } from "@tanstack/react-query";

import { useSession } from "@/lib/auth/auth-client";

export function useFeatures() {
  const { data: session } = useSession();
  const query = useQuery({
    queryKey: ["features", session?.user.id],
    enabled: !!session?.user.id,
    queryFn: async (): Promise<Feature[]> => {
      const response = await fetch("/api/v1/features", { cache: "no-store" });
      if (!response.ok) throw new Error("Failed to fetch features");
      const data: { features: Feature[] } = await response.json();
      return data.features;
    },
  });
  return {
    hasFeature: (feature: Feature) => !!session?.user.id && query.isSuccess && query.data.includes(feature),
  };
}
