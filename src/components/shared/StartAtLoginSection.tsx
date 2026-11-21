import { useEffect, useState } from "react";
import { Switch } from "./Switch";
import { readAutostart, setAutostart, type AutostartStatus, type AutostartUnavailable } from "../../lib/autostart";
import { clipText, endSentence } from "../../lib/utils";

const WHY_NOT: Record<AutostartUnavailable, string> = {
  development: "Not in a development build: the login entry would start this build, not the Vega you installed.",
  flatpak: "Not in the Flatpak yet. Add Vega to your desktop's startup applications instead.",
};

const WHAT_IT_DOES =
  "Vega starts in the tray, with no window, so notifications arrive from the moment you log in. Open it from the tray, or start Vega as usual.";

function reason(err: unknown): string {
  return endSentence(clipText(String(err), 140));
}

/**
 * "Start Vega when I log in": a login entry (`set_autostart` in lib.rs) that starts Vega with
 * `--hidden`, in the tray with no window. It sits with the notifications because they arrive
 * only while Vega runs. The switch shows what the system holds: the entry is read when the
 * section mounts and again after every change, never assumed from the last press.
 */
export function StartAtLoginSection() {
  const [status, setStatus] = useState<AutostartStatus | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    readAutostart()
      .then((s) => live && setStatus(s))
      .catch((e) => live && setReadError(reason(e)));
    return () => {
      live = false;
    };
  }, []);

  const change = async (on: boolean) => {
    if (busy || !status) return;
    setBusy(true);
    setError(null);
    try {
      const enabled = await setAutostart(on);
      setStatus((s) => (s ? { ...s, enabled } : s));
    } catch (e) {
      setError(`Couldn't ${on ? "add Vega to" : "take Vega out of"} the programs that start when you log in: ${reason(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const unavailable = status?.unavailable ? WHY_NOT[status.unavailable] : null;
  const hint = readError
    ? `Couldn't tell whether Vega starts when you log in: ${readError}`
    : unavailable ?? WHAT_IT_DOES;

  return (
    <section>
      <Switch
        checked={status?.enabled ?? false}
        onChange={change}
        label="Start Vega when I log in"
        hint={hint}
        disabled={readError !== null || unavailable !== null}
        busy={busy || (status === null && readError === null)}
      />
      {error && (
        <p role="alert" className="ml-12 mt-1 text-danger text-caption">
          {error}
        </p>
      )}
    </section>
  );
}
