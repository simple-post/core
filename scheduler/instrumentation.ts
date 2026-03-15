import { validateEnv } from "@/lib/env";

export function register() {
  validateEnv();
}
