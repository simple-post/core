function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function extractErrorMessage(data: unknown, fallback: string): string {
  if (typeof data === "string" && data.trim()) {
    return data;
  }

  if (isObject(data)) {
    // TikTok OAuth: { error: "invalid_request", error_description: "...", log_id }
    const ttDesc = typeof data.error_description === "string" ? data.error_description : undefined;
    const ttCode = typeof data.error === "string" ? data.error : undefined;
    if (ttDesc && ttCode) {
      return `${ttCode}: ${ttDesc}`;
    }
    if (ttDesc) {
      return ttDesc;
    }

    // Facebook/Meta returns { error: { message: "...", type: "...", code: N } }
    if (isObject(data.error)) {
      const nested = data.error;
      const msg = typeof nested.message === "string" ? nested.message : undefined;
      const type = typeof nested.type === "string" ? nested.type : undefined;
      if (msg) {
        return type ? `${type}: ${msg}` : msg;
      }
    }

    // Instagram OAuth: { error_type, code, error_message }
    const igMsg = typeof data.error_message === "string" ? data.error_message : undefined;
    const igType = typeof data.error_type === "string" ? data.error_type : undefined;
    if (igMsg) {
      return igType ? `${igType}: ${igMsg}` : igMsg;
    }

    for (const key of ["error_description", "detail", "message", "title", "error"]) {
      const value = data[key];
      if (typeof value === "string" && value.trim()) {
        return value;
      }
    }
  }

  return fallback;
}

export async function fetchJson<T>(input: string, init: RequestInit, label: string): Promise<T> {
  const response = await fetch(input, init);
  const raw = await response.text();
  let data: unknown;
  if (raw) {
    try {
      data = JSON.parse(raw) as unknown;
    } catch {
      data = raw;
    }
  }

  if (!response.ok) {
    const message = extractErrorMessage(data, response.statusText);
    throw new Error(`${label} failed (${response.status}): ${message}`);
  }

  return data as T;
}
