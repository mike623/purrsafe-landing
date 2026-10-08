/**
 * Recovers a beta funnel token from the current location.
 *
 * The Supabase confirmation email emits the token in the URL **fragment**
 * (`/beta#confirm=…`, `/beta/unsubscribe#token=…`) on purpose: a fragment is
 * never transmitted to the server, so the credential stays out of GET query
 * strings, the HTTP `Referer` header, and Cloudflare Pages access-log URLs. The
 * fragment is therefore the contract, and it is read first.
 *
 * The query string is a defence-in-depth fallback only. A stray query-form link
 * — a hand-edited URL, a mail client that rewrote the fragment away, or a
 * regression in the emitter — should still confirm or unsubscribe instead of
 * silently reporting an invalid link. The caller strips the token from the
 * address bar with `history.replaceState` either way, so a token that did
 * arrive in the query string does not survive in `location.href`.
 *
 * Returns `null` when the key is absent or present but empty, so callers can
 * treat "no token" as one case.
 */
export function betaTokenFrom(
  location: { hash: string; search: string },
  key: string,
): string | null {
  const fromFragment = new URLSearchParams(location.hash.slice(1)).get(key);
  if (fromFragment) return fromFragment;

  return new URLSearchParams(location.search).get(key) || null;
}
