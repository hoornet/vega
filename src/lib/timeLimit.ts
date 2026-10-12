/**
 * `work`, or a rejection saying `message` when it has not settled after `ms`.
 *
 * The clock is cleared either way, so nothing is left ticking after the work
 * finished. The work itself is not stopped: a signer that answers late still
 * publishes, which is why a caller that gave up may want to hear of it.
 */
export function withinTime<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const clock = setTimeout(() => reject(new Error(message)), ms);
    work.then(
      (value) => { clearTimeout(clock); resolve(value); },
      (err) => { clearTimeout(clock); reject(err); },
    );
  });
}
