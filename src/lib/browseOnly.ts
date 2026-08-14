/**
 * "Browse without signing in" — the user chose to skip onboarding entirely.
 *
 * Vega already works without an identity: `useCanSign()` returns false with no
 * pubkey, and every action that needs a signature is gated on it. What was
 * missing was a way *past* the onboarding wall, since `App.tsx` treated the
 * presence of `wrystr_pubkey` as the only proof that onboarding was done — so
 * signing out and restarting put you right back at the welcome screen.
 *
 * This flag is that second proof. It is intentionally not cleared on login:
 * a user who has once said "let me look around" should not be walled again if
 * they later sign out. See issue #34.
 */
const BROWSE_ONLY_KEY = "wrystr_browse_only";

export function isBrowseOnly(): boolean {
  try {
    return localStorage.getItem(BROWSE_ONLY_KEY) === "1";
  } catch {
    return false;
  }
}

export function setBrowseOnly(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(BROWSE_ONLY_KEY, "1");
    else localStorage.removeItem(BROWSE_ONLY_KEY);
  } catch { /* ignore */ }
}
