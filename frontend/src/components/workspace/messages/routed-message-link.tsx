import { type ComponentProps } from "react";

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
  if (!src) return null;

  const imgClassName = "overflow-hidden rounded-lg max-w-[90%]";

  if (typeof src !== "string") {
    return <img className={imgClassName} src={src} alt={alt} {...props} />;
  }

  const reference = /^(?:https?:|data:|blob:|\/\/)/i.test(src)
    ? src
    : normalizeWorkspaceArtifactRef(src, threadId);
  const url = parseWorkspaceOutputRef(reference)
    ? urlOfArtifact({ filepath: reference, threadId })
    : src.startsWith("/mnt/")
      ? resolveArtifactURL(src, threadId)
      : src;

  return (
    <RoutedMessageLink href={url}>
      <AuthenticatedImage
        className={imgClassName}
        src={url}
        alt={alt ?? ""}
        {...props}
      />
    </RoutedMessageLink>
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
