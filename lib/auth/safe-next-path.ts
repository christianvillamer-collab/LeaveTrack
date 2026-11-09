/**
 * Only same-origin, absolute paths may be used as a post-login destination.
 *
 * Browsers normalize a backslash to a slash, so `/\evil.example` becomes the
 * protocol-relative `//evil.example` and would leave the site. Reject it
 * explicitly along with `//host` and control characters.
 */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next === "/login") {
    return null;
  }

  if (next.includes("\\") || /[\u0000-\u001f]/.test(next)) {
    return null;
  }

  return next;
}
