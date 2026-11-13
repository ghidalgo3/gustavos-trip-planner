import { apiBaseUrl } from "../../api/config";
import { tripFetch } from "../../api/tripDocumentStore";

export type ActivityKindPage = { kinds: string[]; hasMore: boolean };

export async function listActivityKinds(
  query: { search?: string; top?: number; skip?: number } = {},
  signal?: AbortSignal,
): Promise<ActivityKindPage> {
  const params = new URLSearchParams();
  if (query.search !== undefined) params.set("search", query.search);
  if (query.top !== undefined) params.set("top", String(query.top));
  if (query.skip !== undefined) params.set("skip", String(query.skip));
  const response = await tripFetch(
    `${apiBaseUrl}/user/activity-kinds?${params}`,
    {
      credentials: "include",
      cache: "no-store",
      signal,
    },
  );
  if (!response.ok) throw new Error("Kind suggestions are unavailable.");
  return response.json();
}
