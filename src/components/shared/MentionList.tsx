import { useState } from "react";
import { nameOf, ownName } from "../../lib/utils";
import { mentionedPubkeys } from "../../lib/mentions";
import { useProfile } from "../../hooks/useProfile";
import type { MentionListProps } from "../../hooks/useMentions";
import { AvatarInitial } from "./AvatarInitial";

function Avatar({ profile }: { profile: unknown }) {
  const picture = (profile as { picture?: unknown } | null | undefined)?.picture;
  const [failed, setFailed] = useState(false);
  if (typeof picture === "string" && picture && !failed) {
    return <img src={picture} alt="" className="w-6 h-6 rounded-full object-cover bg-bg shrink-0" onError={() => setFailed(true)} />;
  }
  return (
    <span aria-hidden className="w-6 h-6 rounded-full bg-bg border border-border flex items-center justify-center text-text-dim text-micro shrink-0">
      <AvatarInitial profile={profile} />
    </span>
  );
}

/** People to mention, under the box. The box keeps the keyboard: the list is its `aria-activedescendant`. */
export function MentionList({ id, optionId, people, active, onPick, onHover }: MentionListProps) {
  return (
    <ul id={id} role="listbox" aria-label="People to mention" className="mt-1 mb-2 max-w-sm rounded-lg border border-border bg-bg-raised py-1">
      {people.map(({ pubkey, profile }, i) => {
        const nip05 = (profile as { nip05?: unknown } | null | undefined)?.nip05;
        const name = nameOf(profile, pubkey);
        const address = typeof nip05 === "string" && nip05 && ownName(profile) !== nip05 ? nip05 : null;
        return (
          <li
            key={pubkey}
            id={optionId(i)}
            role="option"
            aria-label={address ? `${name}, ${address}` : name}
            aria-selected={i === active}
            // A press must not take focus from the box: the pick puts the caret back after the mention.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(pubkey)}
            onMouseEnter={() => onHover(i)}
            className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer ${i === active ? "bg-accent/10" : ""}`}
          >
            <Avatar profile={profile} />
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-ui ${i === active ? "text-accent" : "text-text"}`}>{name}</span>
              {address && <span className="block truncate text-caption text-text-muted">{address}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function MentionedName({ pubkey }: { pubkey: string }) {
  const profile = useProfile(pubkey);
  return <span className="text-text">{nameOf(profile, pubkey)}</span>;
}

/**
 * Who the text mentions, by name: in the box a mention is `nostr:npub1…`, which says nothing to the
 * person writing. Nothing when it mentions nobody.
 */
export function MentionedPeople({ text }: { text: string }) {
  const pubkeys = mentionedPubkeys(text);
  if (pubkeys.length === 0) return null;
  return (
    <p className="text-text-muted text-caption mt-1">
      Mentions:{" "}
      {pubkeys.map((pk, i) => (
        <span key={pk}>
          {i > 0 && ", "}
          <MentionedName pubkey={pk} />
        </span>
      ))}
    </p>
  );
}
