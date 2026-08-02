const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("vigilai_token");
}

export function setToken(token: string) {
  localStorage.setItem("vigilai_token", token);
}

export function clearToken() {
  localStorage.removeItem("vigilai_token");
}

export async function api<T>(
  path: string,
  opts: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  const headers = new Headers(opts.headers);
  headers.set("Content-Type", "application/json");
  if (opts.auth !== false) {
    const token = getToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  const res = await fetch(`${API_URL}${path}`, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? res.statusText);
  }
  return data as T;
}

export { API_URL };
