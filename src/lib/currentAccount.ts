// Which account is signed in, for code that must not import the user store.
//
// The user store imports the mute, bookmark and other stores, so those cannot
// import it back. They still need to know whether the account changed between
// a toast being raised and its "Try again" being pressed. The user store
// writes here whenever its pubkey changes. A leaf: it imports nothing.

let current: string | null = null;

export const currentAccount = (): string | null => current;

export function setCurrentAccount(pubkey: string | null): void {
  current = pubkey;
}

/**
 * Whether the account read before an await is still the one signed in.
 *
 * A publish takes seconds and the account can change meanwhile. What comes
 * back then is not the new account's: not its toast, not its "Undo".
 */
export const stillAccount = (account: string | null): boolean => current === account;
