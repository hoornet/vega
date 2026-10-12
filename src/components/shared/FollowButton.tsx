import { useState } from "react";
import { useUserStore, useCanSign } from "../../stores/user";
import { useToastStore } from "../../stores/toast";
import { Button, type ButtonSize } from "./Button";

// The follow button, one way.
//
// It was written out four times (profile, People, search results, suggested
// people) with three looks, and one copy had no guard against a second press
// while the first was publishing.
//
// Not following: a primary "Follow". Following: a quiet "Following", so a list
// of people you follow is not a column of loud buttons. Under the pointer or
// the keyboard focus it reads "Unfollow" in red: the label at rest is the
// state, and the label you are about to press is the action.

interface FollowButtonProps {
  pubkey: string;
  size?: ButtonSize;
  className?: string;
}

export function FollowButton({ pubkey, size, className = "" }: FollowButtonProps) {
  const canSign = useCanSign();
  const own = useUserStore((s) => s.pubkey);
  const isFollowing = useUserStore((s) => s.follows.includes(pubkey));
  const listStatus = useUserStore((s) => s.followsStatus);
  const follow = useUserStore((s) => s.follow);
  const unfollow = useUserStore((s) => s.unfollow);
  const [pending, setPending] = useState(false);
  // Straight after a press the pointer is still on the button. "Unfollow" in
  // red there would read as if the press had unfollowed. It waits until the
  // pointer or the focus has left once.
  const [settling, setSettling] = useState(false);
  const settle = () => setSettling(false);

  // Read-only accounts cannot publish a contact list, and nobody follows themselves.
  if (!canSign || pubkey === own) return null;

  const toggle = async () => {
    setPending(true);
    setSettling(true);
    try {
      if (isFollowing) await unfollow(pubkey);
      else await follow(pubkey);
    } catch {
      // The store reports the failures it knows about and resolves. Anything
      // that reaches here is one it did not expect, and must not pass in silence.
      useToastStore.getState().addToast(isFollowing ? "Couldn't unfollow. Nothing was changed." : "Couldn't follow. Nothing was changed.", "error");
    } finally {
      setPending(false);
    }
  };

  if (isFollowing) {
    const offer = !pending && !settling;
    return (
      <Button variant="ghost" tone={offer ? "danger" : "neutral"} size={size} busy={pending} onClick={toggle} onPointerLeave={settle} onBlur={settle} className={`group ${className}`}>
        {/* Both labels share one cell: the button is as wide as the longer one and does not move when they swap. */}
        <span className="grid">
          <span className={`col-start-1 row-start-1 ${offer ? "group-hover:invisible group-focus-visible:invisible" : ""}`}>Following</span>
          <span className={`col-start-1 row-start-1 invisible ${offer ? "group-hover:visible group-focus-visible:visible" : ""}`}>Unfollow</span>
        </span>
      </Button>
    );
  }

  // "Not in the list" proves nothing until the list has loaded.
  if (listStatus === "unknown") {
    // It could not be loaded, so this person may already be followed. Follow
    // stays usable, because the store fetches the list again before it changes
    // anything, but it is not offered as the main action.
    return (
      <Button size={size} busy={pending} onClick={toggle} onPointerLeave={settle} onBlur={settle} title="Your follow list has not loaded. Pressing this tries again." className={className}>
        Follow
      </Button>
    );
  }
  return (
    <Button variant="primary" size={size} busy={pending || listStatus === "loading"} onClick={toggle} onPointerLeave={settle} onBlur={settle} className={className}>
      Follow
    </Button>
  );
}
