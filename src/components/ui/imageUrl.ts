// Which venue image URLs the app will load (iOS VenueImageView.parseURL).
//
// Supabase-hosted asset URLs sometimes carry characters (spaces, Icelandic
// letters) a strict URL parser refuses; iOS percent-encodes them and tries
// again, and so does this. Only http and https load: anything else (empty,
// a data or file URL, a relative path) is no image, which draws the
// placeholder. The app never substitutes another picture for a missing one: a
// stock photo shown as a venue misrepresents the venue.

/** Runs of characters a URL may not carry raw: anything but printable ASCII, and the unsafe set. */
const UNSAFE = /(?:[^\x21-\x7E]|["<>\\^`{|}])+/g;

export function normaliseImageUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^https?:\/\//i.test(trimmed)) return null;
  const encoded = trimmed.replace(UNSAFE, (run) => {
    try {
      return encodeURIComponent(run);
    } catch {
      // A lone surrogate cannot be encoded; drop it rather than the image.
      return '';
    }
  });
  // A host is required ("https://" alone is not an image).
  const host = /^https?:\/\/([^/?#]+)/i.exec(encoded);
  return host && host[1] ? encoded : null;
}
