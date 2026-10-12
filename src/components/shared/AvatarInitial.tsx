import { UserRound } from "lucide-react";
import { initialOf, ownName } from "../../lib/utils";

/**
 * What stands in the round placeholder where an account's picture would be:
 * the first letter of its name, or the outline of a person when it has none.
 *
 * The letter used to be the first character of whatever was shown as the
 * name, fallback included. An account with no name was "N" where the
 * fallback was its npub and a hex digit where it was the hex key: the same
 * new account was "N" in the sidebar and "B" on its own profile. A letter
 * taken from a key says nothing, so an account with no name gets no letter.
 *
 * `profile` is anything with a name on it: a profile, a search result, a
 * saved account.
 */
export function AvatarInitial({ profile }: { profile: unknown }) {
  const initial = initialOf(ownName(profile));
  if (initial) return <>{initial}</>;
  // Decoration (the icon library marks it `aria-hidden` itself): the name
  // beside it, or the label of the button around it, says who it is.
  return <UserRound className="w-[60%] h-[60%]" />;
}
