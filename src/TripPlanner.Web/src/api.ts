export type CurrentUser = {
  isAuthenticated: boolean;
  name?: string;
  email?: string;
  provider?: string;
};

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

export async function getCurrentUser(signal?: AbortSignal): Promise<CurrentUser> {
  const response = await fetch(`${apiBaseUrl}/api/user`, {
    credentials: "include",
    signal,
  });

  if (!response.ok) {
    throw new Error(`The API returned ${response.status}.`);
  }

  return response.json() as Promise<CurrentUser>;
}

export function loginUrl(provider: "google" | "aad"): string {
  const returnTo = `${window.location.origin}/`;
  return `${apiBaseUrl}/.auth/login/${provider}?post_login_redirect_uri=${encodeURIComponent(returnTo)}`;
}

export function logoutUrl(): string {
  const returnTo = `${window.location.origin}/`;
  return `${apiBaseUrl}/.auth/logout?post_logout_redirect_uri=${encodeURIComponent(returnTo)}`;
}
