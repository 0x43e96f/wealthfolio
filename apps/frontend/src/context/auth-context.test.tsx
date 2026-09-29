import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { notifyUnauthorized } from "@/lib/auth-token";
import { AuthGate, AuthProvider } from "./auth-context";

vi.mock("@/adapters", () => ({ isWeb: true }));
vi.mock("@/features/profiles/session", () => ({ revokeProfileSession: vi.fn() }));
const fetchMock = vi.fn<typeof fetch>();
const status = (requiresPassword = true) => Response.json({ requiresPassword, oidcEnabled: false });
const mount = () =>
  render(
    <AuthProvider>
      <AuthGate fallback={<div>Sign in</div>}>
        <div>Private portfolio</div>
      </AuthGate>
    </AuthProvider>,
  );
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it.each(["network", "server", "invalid JSON"])(
  "keeps financial content hidden when auth discovery fails: %s",
  async (failure) => {
    if (failure === "network") fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    else if (failure === "server") fetchMock.mockResolvedValue(new Response(null, { status: 503 }));
    else fetchMock.mockResolvedValue(Response.json({}));
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to verify your connection");
    expect(screen.queryByText("Private portfolio")).not.toBeInTheDocument();
    expect(screen.queryByText("Sign in")).not.toBeInTheDocument();
    fetchMock.mockResolvedValue(status(false));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Private portfolio")).toBeInTheDocument();
  },
);

it("shows login only when the session check confirms a 401", async () => {
  fetchMock
    .mockResolvedValueOnce(status())
    .mockResolvedValueOnce(new Response(null, { status: 401 }));
  mount();
  expect(await screen.findByText("Sign in")).toBeInTheDocument();
  expect(screen.queryByText("Private portfolio")).not.toBeInTheDocument();
});

it("keeps a session check server failure recoverable without routing to login", async () => {
  fetchMock
    .mockResolvedValueOnce(status())
    .mockResolvedValueOnce(new Response(null, { status: 500 }));
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent("Unable to verify your connection");
  expect(screen.queryByText("Sign in")).not.toBeInTheDocument();
  fetchMock
    .mockResolvedValueOnce(status())
    .mockResolvedValueOnce(Response.json({ authenticated: true }));
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Private portfolio")).toBeInTheDocument();
});

it.each(["status", "me"])(
  "does not accept proxy HTML as a successful %s response",
  async (endpoint) => {
    if (endpoint === "me") fetchMock.mockResolvedValueOnce(status());
    fetchMock.mockResolvedValueOnce(
      new Response("<html>Proxy sign in</html>", {
        headers: { "Content-Type": "text/html" },
      }),
    );
    mount();
    expect(await screen.findByRole("button", { name: "Reload to sign in" })).toBeInTheDocument();
    expect(screen.queryByText("Private portfolio")).not.toBeInTheDocument();
  },
);

it.each(["status", "me"])("times out a stalled %s check and allows retry", async (endpoint) => {
  vi.useFakeTimers();
  if (endpoint === "me") fetchMock.mockResolvedValueOnce(status());
  fetchMock.mockImplementationOnce(
    (_url, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      }),
  );
  mount();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  expect(screen.getByRole("alert")).toHaveTextContent("Unable to verify your connection");
  expect(screen.queryByText("Private portfolio")).not.toBeInTheDocument();
});

it("rechecks instance auth after an unauthorized request even when auth was previously disabled", async () => {
  fetchMock.mockResolvedValueOnce(status(false));
  mount();
  await screen.findByText("Private portfolio");
  fetchMock
    .mockResolvedValueOnce(status())
    .mockResolvedValueOnce(new Response(null, { status: 401 }));
  act(() => notifyUnauthorized());
  expect(screen.queryByText("Private portfolio")).not.toBeInTheDocument();
  expect(await screen.findByText("Sign in")).toBeInTheDocument();
});

it("treats a proxy 524 HTML error as a connection failure", async () => {
  fetchMock.mockResolvedValue(
    new Response("<html>Timeout</html>", {
      status: 524,
      headers: { "Content-Type": "text/html" },
    }),
  );
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent("Unable to verify your connection");
  expect(screen.queryByRole("button", { name: "Reload to sign in" })).not.toBeInTheDocument();
});

it("rejects a redirected authentication response even if its body looks valid", async () => {
  const response = status(false);
  Object.defineProperty(response, "redirected", { value: true });
  fetchMock.mockResolvedValueOnce(response);
  mount();
  expect(await screen.findByRole("button", { name: "Reload to sign in" })).toBeInTheDocument();
  expect(screen.queryByText("Private portfolio")).not.toBeInTheDocument();
});

it("does not admit a successful session response with the wrong body", async () => {
  fetchMock.mockResolvedValueOnce(status()).mockResolvedValueOnce(Response.json({}));
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent("Unable to verify your connection");
  expect(screen.queryByText("Private portfolio")).not.toBeInTheDocument();
});
