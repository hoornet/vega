/**
 * The sidebar's width from where the pointer is, in layout (CSS) pixels.
 *
 * `clientX` is a screen position; the aside's width is a layout length under
 * the text-size zoom (the window's root box, see "Type scale" in CLAUDE.md).
 * Dividing by the zoom keeps the edge under the pointer: left as a plain
 * difference, the edge ran away from the pointer at 1.43× its speed at Extra
 * Large and lagged behind it at Small. The factor comes from the setting, not
 * from a measured ratio of rects: an engine that reports unzoomed rects would
 * measure 1.
 */
export function widthFromPointer(clientX: number, left: number, zoom: number, min: number, max: number): number {
  const width = (clientX - left) / (zoom > 0 ? zoom : 1);
  return Math.min(max, Math.max(min, Math.round(width)));
}
