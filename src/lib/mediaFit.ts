// How a lone image should sit in the feed's fixed 4:3 frame.
//
// The frame has a fixed shape so the virtual list knows a row's height before
// the picture loads. That leaves two ways to fit the picture in it:
//   contain — show all of it, with bars where the shapes differ
//   cover   — fill the frame, cropping what does not fit
// Cropping everything cut the first line off text screenshots and memes;
// containing everything put bars around ordinary photos. So: a picture whose
// shape is close to the frame's fills it (the crop is a few percent at most),
// and anything clearly wider or taller is shown whole.

const FRAME = 4 / 3;
/** How far from the frame's shape a picture may be and still fill it. */
const TOLERANCE = 0.14;

export function soloImageFit(naturalWidth: number, naturalHeight: number): "cover" | "contain" {
  if (!(naturalWidth > 0) || !(naturalHeight > 0)) return "contain";
  const ratio = naturalWidth / naturalHeight;
  return Math.abs(ratio - FRAME) / FRAME <= TOLERANCE ? "cover" : "contain";
}
