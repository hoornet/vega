import { useEffect, useMemo, useRef, useState, useCallback, type RefObject } from "react";
import { renderMarkdown } from "../../lib/markdown";
import { useUIStore } from "../../stores/ui";
import { useProfile } from "../../hooks/useProfile";
import { nameOf } from "../../lib/utils";
import { AvatarInitial } from "../shared/AvatarInitial";
import { fitArticleImage, readingMinutes, stripLeadingTitle } from "../../lib/article";
import { ImageLightbox } from "../shared/ImageLightbox";

// An article as the reader shows it: title, standfirst, byline, cover, body.
// Used by the reader and by the editor's Preview, so what a writer previews is
// what a reader will see; Preview used to have a stylesheet of its own.
// Typography is in index.css (`.reader-page`, `.reader`, `.prose-article`);
// this goes inside an `article.reader`.

export interface ArticleBodyProps {
  title: string;
  summary?: string;
  image?: string;
  pubkey: string;
  publishedAt: number | null;
  content: string;
  /** The element the markdown is rendered into, for a caller that reads its headings or its end. */
  contentRef?: RefObject<HTMLDivElement | null>;
  /** A body image took its own shape: the page may have grown or shrunk. */
  onImageFit?: () => void;
}

function AuthorRow({ pubkey, publishedAt, readingTime }: { pubkey: string; publishedAt: number | null; readingTime: number }) {
  const { openProfile } = useUIStore();
  const profile = useProfile(pubkey);
  const name = nameOf(profile, pubkey);
  const date = publishedAt
    ? new Date(publishedAt * 1000).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
    : null;

  return (
    <div className="flex items-center gap-3 mt-5">
      <button type="button" className="shrink-0" onClick={() => openProfile(pubkey)} aria-label={`${name}'s profile`}>
        {profile?.picture ? (
          <img src={profile.picture} alt="" className="w-9 h-9 rounded-full object-cover hover:opacity-80 transition-opacity"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        ) : (
          <span className="w-9 h-9 rounded-full bg-bg-raised border border-border flex items-center justify-center text-text-dim text-ui" aria-hidden>
            <AvatarInitial profile={profile} />
          </span>
        )}
      </button>
      <div className="min-w-0">
        <button
          type="button"
          onClick={() => openProfile(pubkey)}
          className="text-text text-body font-medium hover:text-accent transition-colors block truncate max-w-full"
        >
          {name}
        </button>
        <p className="text-text-muted text-caption">
          {date && <span>{date} · </span>}
          <span>{readingTime} min read</span>
        </p>
      </div>
    </div>
  );
}

export function ArticleBody({ title, summary, image, pubkey, publishedAt, content, contentRef, onImageFit }: ArticleBodyProps) {
  const ownRef = useRef<HTMLDivElement>(null);
  const ref = contentRef ?? ownRef;
  const [coverFailed, setCoverFailed] = useState(false);
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);
  useEffect(() => { setCoverFailed(false); }, [image]);

  // Rendered once per text, not on every scroll. The repeated title goes
  // before rendering: the HTML is DOMPurify's as it is.
  const bodyHtml = useMemo(() => (content ? renderMarkdown(stripLeadingTitle(content, title)) : ""), [content, title]);

  const handleContentClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (!(target instanceof HTMLImageElement)) return;
    const root = ref.current;
    if (!root) return;
    const imgs = Array.from(root.querySelectorAll<HTMLImageElement>("img"));
    const index = imgs.indexOf(target);
    if (index < 0) return;
    setLightbox({ images: imgs.map((img) => img.src), index });
  }, [ref]);

  // Body images: a 16:9 box until the picture has loaded (index.css), then
  // its own shape, and never wider than it is. `load` does not bubble, but it
  // can be caught on the way down.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = (img: HTMLImageElement) => {
      const got = fitArticleImage(img.naturalWidth, img.naturalHeight);
      if (!got) return;
      img.style.aspectRatio = got.aspectRatio;
      img.style.maxWidth = `${got.maxWidth}px`;
      img.style.height = "auto";
      img.dataset.fitted = "";
      onImageFit?.();
    };
    el.querySelectorAll<HTMLImageElement>("img").forEach((img) => { if (img.complete) fit(img); });
    const onLoad = (e: Event) => { if (e.target instanceof HTMLImageElement) fit(e.target); };
    el.addEventListener("load", onLoad, true);
    return () => el.removeEventListener("load", onLoad, true);
  }, [bodyHtml, ref, onImageFit]);

  return (
    <>
      <h1 className="reader-title">{title || "Untitled"}</h1>
      {summary && <p className="reader-standfirst mt-3">{summary}</p>}
      <AuthorRow pubkey={pubkey} publishedAt={publishedAt} readingTime={readingMinutes(content)} />

      {/* Cover: after the words that say what this is, and never the whole first screen */}
      {image && !coverFailed && (
        <img
          src={image}
          alt=""
          className="w-full aspect-[2/1] max-h-80 object-cover rounded-lg mt-6"
          onError={() => setCoverFailed(true)}
        />
      )}

      <div
        ref={ref}
        className="prose-article mt-8"
        onClick={handleContentClick}
        dangerouslySetInnerHTML={{ __html: bodyHtml }}
      />
      {lightbox && (
        <ImageLightbox
          images={lightbox.images}
          index={lightbox.index}
          onClose={() => setLightbox(null)}
          onNavigate={(i) => setLightbox({ ...lightbox, index: i })}
        />
      )}
    </>
  );
}
