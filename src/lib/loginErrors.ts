// Plain-language messages for a failed key login.
//
// The raw failure is a library exception ("Error: Invalid private key
// provided."), shown on the one screen where a new user has just pasted their
// most sensitive secret. What they need to know is what the field expected and,
// when they pasted the other kind of key, which tab to use instead.

/** A secret key was expected in this field. */
export function explainSecretKeyError(input: string): string {
  const value = input.trim();
  if (value.startsWith("npub1")) {
    return "That is a public key. Use the Public key tab to browse read-only, or paste the secret key (it starts with nsec1).";
  }
  if (value.startsWith("bunker://")) {
    return "That is a remote signer address. Use the Remote signer tab for it.";
  }
  return "That doesn't look like a secret key. It starts with nsec1.";
}

/** A public key was expected in this field. */
export function explainPublicKeyError(input: string): string {
  const value = input.trim();
  if (value.startsWith("nsec1")) {
    return "That is a secret key. Use the Secret key tab to sign in with it.";
  }
  return "That doesn't look like a public key. It starts with npub1.";
}
