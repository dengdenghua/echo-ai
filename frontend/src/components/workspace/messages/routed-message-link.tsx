import { type ComponentProps, useContext, useState } from "react";
import { ChevronDown, ImageIcon } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

import { RoutedWebLink } from "@/components/ui/routed-web-link";
import { AuthenticatedImage } from "@/components/ui/authenticated-image";
import {
  artifactRefFromMarkdownHref,
  dispatchOpenArtifact,
} from "@/core/artifacts/open-artifact";
import { conversationImageURL } from "@/core/navigation/conversation-file";
import {
  FileReferenceScope,
  parseFileReference,
} from "@/core/navigation/file-reference";
import { useI18n } from "@/core/i18n/hooks";
import { messageActionsCopy } from "@/core/i18n/locales/message-actions";
import { conversationFilesCopy } from "@/core/i18n/locales/conversation-files";
import { useImageGalleryRegistration } from "./image-gallery";
import { ImageRegionSelector } from "./image-region-selector";
import { LinkedFileReference } from "./linked-file-reference";
import { decodeMarkdownFileURL } from "@/core/navigation/markdown-file-url";
import { GeneratedFileReference } from "./generated-file-reference";

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
  if (typeof src === "string") src = decodeMarkdownFileURL(src);
  const [expanded, setExpanded] = useState(false);
  const [opened, setOpened] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const scope = useContext(FileReferenceScope);
  const { locale } = useI18n();
  const copy = messageActionsCopy(locale);
  const fileCopy = conversationFilesCopy(locale);
  const url =
    typeof src === "string"
      ? conversationImageURL(src, threadId || scope.threadId, scope.basePath)
      : "";
  const openGallery = useImageGalleryRegistration({ src: url, alt: alt ?? "" });
  if (!src || typeof src !== "string") return null;
  const imageFailure = (
    <span role="alert" className="text-xs text-destructive">
      {fileCopy.imageFailed}
    </span>
  );

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
              if (!openGallery()) setOpened(true);
            }}
            className="block overflow-hidden rounded-lg border bg-muted/20 p-1 focus-visible:outline focus-visible:outline-2"
          >
            <AuthenticatedImage
              {...props}
              key={attempt}
              className="h-20 w-20 rounded object-contain"
              src={url}
              alt={alt ?? ""}
              fallback={imageFailure}
            />
          </button>
          <button
            type="button"
            className="text-xs text-muted-foreground underline"
            onClick={() => setAttempt((value) => value + 1)}
          >
            {fileCopy.reloadImage}
          </button>
          {(parseFileReference(src) || src.startsWith("workspace-output:")) && (
            <LinkedFileReference path={src} label={fileCopy.viewSource} />
          )}
        </div>
      )}
      <Dialog open={opened} onOpenChange={setOpened}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-[90vw]">
          <DialogTitle className="pr-10 text-sm">
            {alt || copy.imagePreview}
          </DialogTitle>
          <ImageRegionSelector
            key={attempt}
            src={url}
            alt={alt ?? ""}
            threadId={threadId || scope.threadId}
            filename={alt ?? undefined}
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
  if (href) href = decodeMarkdownFileURL(href);
  const artifactRef = href ? artifactRefFromMarkdownHref(href) : null;
  if (artifactRef?.startsWith("workspace-output:")) {
    return (
      <GeneratedFileReference
        artifactRef={artifactRef}
        href={href}
        label={typeof children === "string" ? children : undefined}
      />
    );
  }
  const file =
    href &&
    !artifactRef?.startsWith("workspace-output:") &&
    !href.startsWith("/mnt/")
      ? parseFileReference(href)
      : null;
  if (file)
    return (
      <LinkedFileReference
        {...file}
        label={typeof children === "string" ? children : undefined}
      />
    );
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
