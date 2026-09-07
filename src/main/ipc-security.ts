export function isTrustedRendererUrl(candidateValue: string, allowedValue: string): boolean {
  try {
    const candidate = new URL(candidateValue);
    const allowed = new URL(allowedValue);
    return candidate.protocol === allowed.protocol
      && candidate.origin === allowed.origin
      && candidate.pathname === allowed.pathname;
  } catch {
    return false;
  }
}
