export interface ApiError {
  message: string;
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    // Redirection douce vers /login en cas de 401.
    if (res.status === 401) {
      if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
        window.location.href = "/login";
      }
    }
    let msg = res.statusText;
    try {
      const data = await res.json();
      if (typeof data === "string") msg = data;
      else if (data?.error) msg = data.error;
      else if (data?.message) msg = data.message;
    } catch {
      // ignore
    }
    throw new Error(msg || `Erreur API (${res.status})`);
  }
  return (await res.json()) as T;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
  });
  return handleResponse<T>(res);
}

export async function apiPost<T, B = unknown>(path: string, body: B, method?: string): Promise<T> {
  const res = await fetch(path, {
    method: method ?? "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return handleResponse<T>(res);
}

export async function apiDelete(path: string): Promise<void> {
  const res = await fetch(path, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) {
    await handleResponse<unknown>(res);
  }
}

/** PUT raw body (e.g. file content). Returns JSON if present. */
export async function apiPutRaw(path: string, body: string | Blob): Promise<{ ok?: boolean; error?: string }> {
  const res = await fetch(path, {
    method: "PUT",
    credentials: "include",
    body,
  });
  const ct = res.headers.get("Content-Type") ?? "";
  if (!res.ok) {
    if (ct.includes("application/json")) {
      const data = (await res.json()) as { error?: string; message?: string };
      throw new Error(data?.error ?? data?.message ?? res.statusText);
    }
    throw new Error(res.statusText);
  }
  if (ct.includes("application/json")) {
    return (await res.json()) as { ok?: boolean; error?: string };
  }
  return { ok: true };
}

