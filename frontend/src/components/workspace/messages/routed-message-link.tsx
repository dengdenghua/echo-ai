import { type ComponentProps, useState } from "react";
import { ChevronDown, ImageIcon } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

import { RoutedWebLink } from "@/components/ui/routed-web-link";
import { AuthenticatedImage } from "@/components/ui/authenticated-image";
import {
  artifactRefFromMarkdownHref,
  dispatchOpenArtifact,
} from "@/core/artifacts/open-artifact";
import {
  normalizeWorkspaceArtifactRef,
  parseWorkspaceOutputRef,
  resolveArtifactURL,
  urlOfArtifact,
} from "@/core/artifacts/utils";
import { useI18n } from "@/core/i18n/hooks";
import { messageActionsCopy } from "@/core/i18n/locales/message-actions";
import {
  openInGallery,
  useImageGalleryRegistration,
} from "./image-gallery";
import { ImageRegionSelector } from "./image-region-selector";

/**
 * Custom image component that handles artifact URLs
 */
export function MessageImage({
  src,
  alt,
  threadId,
  maxWidth: _maxWidth = "90%",
  ...props
}: React.ImgHTMLAttributes<HTMLImageElement> & {
  threadId: string;
  maxWidth?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [opened, setOpened] = useState(false);
  const { locale } = useI18n();
  const copy = messageActionsCopy(locale);
  useImageGalleryRegistration({ src: src ?? "", alt: alt ?? "" });
  if (!src || typeof src !== "string") return null;

  const reference = /^(?:https?:|data:|blob:|\/\/)/i.test(src)
    ? src
    : normalizeWorkspaceArtifactRef(src, threadId);
  const url = parseWorkspaceOutputRef(reference)
    ? urlOfArtifact({ filepath: reference, threadId })
    : src.startsWith("/mnt/")
      ? resolveArtifactURL(src, threadId)
      : src;

  return (
    <span className="my-2 block" data-testid="message-image">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        className="inline-flex items-center gap-1.5 rounded text-xs text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2"
      >
        <ImageIcon className="size-3.5" />
        {copy.imagePreview}
        <ChevronDown
          className={`size-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>
      {expanded && (
        <div className="mt-2 flex flex-col items-center gap-2">
          <button
            type="button"
            aria-label={copy.openImage}
            onClick={() => {
              // Gallery lightbox when the answer has multiple registered
              // images (◀ ▶ + thumbnails); falls back to the plain dialog.
              if (!openInGallery(0)) setOpened(true);
            }}
            className="block overflow-hidden rounded-lg border bg-muted/20 p-1 focus-visible:outline focus-visible:outline-2"
          >
            <AuthenticatedImage
              {...props}
              className="h-20 w-20 rounded object-contain"
              src={url}
              alt={alt ?? ""}
            />
          </button>
          {/* Circle-to-edit: drag a region on the rendered image and quote
              the percent coordinates back into the composer. */}
          <ImageRegionSelector
            src={url}
            alt={alt ?? ""}
            threadId={threadId}
            filename={alt ?? undefined}
          />
        </div>
      )}
      <Dialog open={opened} onOpenChange={setOpened}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-[90vw]">
          <DialogTitle className="pr-10 text-sm">
            {alt || copy.imagePreview}
          </DialogTitle>
          <AuthenticatedImage
            src={url}
            alt={alt ?? ""}
            className="mx-auto max-h-[75dvh] max-w-full object-contain"
          />
        </DialogContent>
      </Dialog>
    </span>
  );
}

export function RoutedMessageLink({
  href,
  onClick,
  children,
  ...props
}: ComponentProps<"a">) {
  if (typeof href === "string" && isVideoPreviewHref(href)) {
    return (
      <VideoPreviewLink {...props} href={href} onClick={onClick}>
        {children}
      </VideoPreviewLink>
    );
  }

  return (
    <RoutedWebLink
      {...props}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || !href) return;
        const artifactRef = artifactRefFromMarkdownHref(href);
        if (artifactRef && dispatchOpenArtifact(artifactRef)) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      openTargetSource="conversation"
    >
      {children}
    </RoutedWebLink>
  );
}

function VideoPreviewLink({
  href,
  onClick,
  children,
  ...props
}: ComponentProps<"a"> & { href: string }) {
  const { locale } = useI18n();
  const label =
    typeof children === "string"
      ? children
      : messageActionsCopy(locale).videoPreview;
  return (
    <span className="my-3 block w-full max-w-3xl">
      <video
        aria-label={label}
        className="aspect-video w-full rounded-xl bg-black shadow-sm"
        controls
        playsInline
        preload="metadata"
        src={href}
      />
      <RoutedWebLink
        {...props}
        className="mt-1.5 inline-block text-xs text-muted-foreground underline underline-offset-2"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => {
          onClick?.(event);
          if (event.defaultPrevented) return;
        }}
        openTargetSource="conversation"
      >
        {children}
      </RoutedWebLink>
    </span>
  );
}

function isVideoPreviewHref(href: string): boolean {
  return /\.(?:mp4|webm|m4v|mov)(?:[?#].*)?$/i.test(href.trim());
}
