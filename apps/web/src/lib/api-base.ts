// Base URL shown to the developer for API access. On the public domain the
// gateway is same-origin (/api/v1/*); locally it is the gateway port.
export function apiBaseUrl(): string {
  if (typeof window === "undefined") return "https://dgtlz.my.id/api/v1";
  return window.location.hostname === "localhost"
    ? "http://localhost:4101/api/v1"
    : `${window.location.origin}/api/v1`;
}
