export class HttpResponseError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}
export function isAccessDenied(error: unknown): boolean {
  return (
    error instanceof HttpResponseError && [401, 403].includes(error.status)
  );
}
