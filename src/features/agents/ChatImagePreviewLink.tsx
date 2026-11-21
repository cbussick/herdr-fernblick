import { isDomElement } from "../../shared/lib/dom";
import { useState } from "react";
import type { ReactNode } from "react";
import { ImageLightbox } from "./ImageLightbox";
import type { PreviewImage } from "./ImageLightbox";

/** Keep a real destination for browser actions, but preview on ordinary activation. */
export function ChatImagePreviewLink({
  href,
  images,
  children,
  label,
  control = false,
}: {
  href: string;
  images: Array<PreviewImage>;
  children: ReactNode;
  label?: string;
  control?: boolean;
}) {
  const [index, setIndex] = useState<number>();
  return (
    <>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={label}
        aria-haspopup="dialog"
        data-message-control={control ? true : undefined}
        onClick={(event) => {
          if (
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
          ) {
            return;
          }
          event.preventDefault();
          const src = isDomElement(event.target)
            ? event.target.closest("img")?.getAttribute("src")
            : undefined;
          setIndex(
            Math.max(
              0,
              images.findIndex((image) => image.url === src),
            ),
          );
        }}
      >
        {children}
      </a>
      {index !== undefined ? (
        <ImageLightbox
          images={images}
          index={index}
          onIndexChange={setIndex}
          onClose={() => setIndex(undefined)}
          openLink={href}
        />
      ) : null}
    </>
  );
}
