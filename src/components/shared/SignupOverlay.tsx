import { BodyPortal } from "./BodyPortal";
import { useModal } from "../../hooks/useModal";
import { useUIStore } from "../../stores/ui";
import { OnboardingFlow, EmbeddedOnboarding } from "../onboarding/OnboardingFlow";

/**
 * The sign-up flow over the running app: the same screens as the first
 * launch, as a modal. A modal in every way the rest of the app can tell:
 * `aria-modal` (so the shortcuts stay off), a focus trap, focus back where
 * it was on close, Escape through the layer stack. Rendered at <body> so it
 * is above a dialog that was open when it was asked for (the zap dialog's
 * "Sign in", then "Create an account").
 */
export function SignupOverlay() {
  const signup = useUIStore((s) => s.signup);
  const closeSignup = useUIStore((s) => s.closeSignup);
  if (!signup) return null;
  return <Overlay start={signup} onClose={closeSignup} />;
}

function Overlay({ start, onClose }: { start: "create" | "login"; onClose: () => void }) {
  const { container } = useModal(onClose);
  return (
    <BodyPortal>
      <div
        ref={container}
        role="dialog"
        aria-modal="true"
        aria-label={start === "create" ? "Create account" : "Sign in"}
        tabIndex={-1}
        className="fixed inset-0 z-50 bg-bg overflow-y-auto outline-none"
      >
        <EmbeddedOnboarding.Provider value={true}>
          <OnboardingFlow start={start} onComplete={onClose} onCancel={onClose} />
        </EmbeddedOnboarding.Provider>
      </div>
    </BodyPortal>
  );
}
