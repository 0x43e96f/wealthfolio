export type AuthFailure = "expired" | "signIn";

/** A proxy navigation is not proof that the instance session was revoked. */
export function classifyAuthResponse(response: Response): AuthFailure | null {
  if (
    response.redirected ||
    (response.ok && response.headers.get("content-type")?.includes("text/html"))
  ) {
    return "signIn";
  }
  return response.status === 401 ? "expired" : null;
}

let unauthorizedHandler: ((reason: AuthFailure) => void) | null = null;

export const setUnauthorizedHandler = (handler: ((reason: AuthFailure) => void) | null) => {
  unauthorizedHandler = handler;
};

export const notifyUnauthorized = (reason: AuthFailure = "expired") => {
  unauthorizedHandler?.(reason);
};
