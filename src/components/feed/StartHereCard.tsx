import { useEffect, useState } from "react";
import { Check, Circle, X } from "lucide-react";
import { useUserStore, useCanSign } from "../../stores/user";
import { useUIStore } from "../../stores/ui";
import { useBackupStore } from "../../stores/backup";
import { useFirstRunStore, endFirstRun, FOLLOWS_TO_START } from "../../stores/firstRun";
import { storedInterests } from "../../lib/interests";
import { ownName, clipText, endSentence } from "../../lib/utils";
import { BackupDialog } from "../shared/BackupDialog";

// The first screen after making an account used to be the Trending tab with
// nothing on it to say what to do, and the topics picked a moment earlier
// were kept in one place: the empty Following tab, which nobody was on.
// This card sits above the feed, on every tab, until it is dismissed or
// everything on it is done.

function Row({ done, label, onClick }: { done?: boolean; label: string; onClick: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={`w-full flex items-center gap-2 py-1 text-left text-ui hover:text-accent transition-colors ${done ? "text-text-dim" : "text-text"}`}
      >
        {done ? <Check size={16} className="text-success shrink-0" aria-hidden="true" /> : <Circle size={16} className="text-text-dim shrink-0" aria-hidden="true" />}
        {done && <span className="sr-only">Done: </span>}
        <span className={done ? "line-through" : ""}>{label}</span>
      </button>
    </li>
  );
}

export function StartHereCard() {
  const pubkey = useUserStore((s) => s.pubkey);
  const loggedIn = useUserStore((s) => s.loggedIn);
  const profile = useUserStore((s) => s.profile);
  const follows = useUserStore((s) => s.follows);
  const ownProfileRead = useUserStore((s) => s.ownProfileRead);
  const canSign = useCanSign();
  const pending = useBackupStore((s) => s.pending);
  const firstRun = useFirstRunStore((s) => s.accounts);
  const saidHello = useFirstRunStore((s) => s.hello);
  const [backup, setBackup] = useState(false);

  const shown = !!pubkey && loggedIn && canSign && firstRun.includes(pubkey);
  // Two rows, not one "picture and bio": a row that stayed open after the
  // picture was added read as stuck.
  const hasPicture = typeof profile?.picture === "string" && profile.picture.length > 0;
  const hasBio = typeof profile?.about === "string" && profile.about.trim().length > 0;
  const followed = follows.length >= FOLLOWS_TO_START;
  const hello = !!pubkey && saidHello.includes(pubkey);
  const needsBackup = !!pubkey && pending.includes(pubkey);
  // The backup dialog is what completes the last row, and it must not be
  // unmounted under the "Copied" it is about to show: done waits for it.
  const complete = hasPicture && hasBio && followed && hello && !needsBackup && !backup;

  // Done is for good, like Dismiss: the card must not come back for an
  // account that removes its picture later.
  useEffect(() => {
    if (shown && complete && pubkey) endFirstRun(pubkey);
  }, [shown, complete, pubkey]);

  if (!shown || complete || !pubkey) return null;
  const name = ownName(profile);
  const interests = storedInterests(pubkey);
  // The edit form opens on what is held; with the profile not read yet it
  // would open on nothing and the save replace a fuller one elsewhere. Until
  // the relays have answered, the row leads to the profile, where "Set up
  // your profile" waits for the same answer.
  const profileKnown = !!profile || ownProfileRead === "none";
  const ui = useUIStore.getState();
  const dismiss = () => endFirstRun(pubkey);

  return (
    <section aria-labelledby="start-here-title" className="border-b border-border-subtle bg-bg-raised shrink-0">
      <div className="content-column-block px-4 py-3">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <h2 id="start-here-title" className="text-text text-body font-medium truncate">{name ? endSentence(`Welcome, ${clipText(name, 40)}`) : "Welcome."}</h2>
            <p className="text-text-muted text-caption">A few things to do first.</p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss"
            className="shrink-0 w-8 h-8 -mr-2 -mt-1 flex items-center justify-center rounded-sm text-text-dim hover:text-text hover:bg-text/8 transition-colors"
          >
            <X size={16} />
          </button>
        </div>
        <ul className="mt-2">
          <Row done={hasPicture} label="Add a picture" onClick={() => (profileKnown ? ui.openProfileEditor(pubkey) : ui.openProfile(pubkey))} />
          <Row done={hasBio} label="Write a bio" onClick={() => (profileKnown ? ui.openProfileEditor(pubkey) : ui.openProfile(pubkey))} />
          <Row done={followed} label="Follow a few people" onClick={() => { ui.setFollowsTab("following"); ui.openView("follows"); }} />
          {needsBackup && <Row label="Back up your secret key" onClick={() => setBackup(true)} />}
          <Row done={hello} label="Say hello" onClick={() => ui.requestCompose()} />
        </ul>
        {interests.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-text-dim text-caption mr-1">Topics you picked:</span>
            {interests.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => ui.openHashtag(tag)}
                className="px-2.5 py-1 text-ui border border-border text-text-muted hover:border-accent/40 hover:text-accent transition-colors rounded-sm"
              >
                #{tag}
              </button>
            ))}
          </div>
        )}
      </div>
      {backup && <BackupDialog pubkey={pubkey} onClose={() => setBackup(false)} />}
    </section>
  );
}
