import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BackIcon, ChevronIcon, CloseIcon, ImageIcon } from "../../shared/ui/Icons";
import styles from "./ImageLightbox.module.css";

export type PreviewImage = { url: string; alt: string };
interface ImageLightboxProps {
  images: PreviewImage[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  openLink?: string;
}

function ExpandedImage({ url, alt }: PreviewImage) {
  const [unavailable, setUnavailable] = useState(false);
  return unavailable ? (
    <div className={styles.unavailable} role="img" aria-label="Attachment unavailable">
      <ImageIcon />
      <p>Attachment no longer available</p>
    </div>
  ) : (
    <img src={url} alt={alt} referrerPolicy="no-referrer" onError={() => setUnavailable(true)} />
  );
}

/** Shared modal for draft attachments and each chat message's image gallery. */
export function ImageLightbox({
  images,
  index,
  onIndexChange,
  onClose,
  openLink,
}: ImageLightboxProps) {
  const lightbox = useRef<HTMLDialogElement>(null);
  const image = images[index];
  const multiple = images.length > 1;
  useEffect(() => {
    const modal = lightbox.current;
    const opener = document.activeElement as HTMLElement | null;
    if (modal && !modal.open) modal.showModal();
    return () => {
      if (modal?.open) modal.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  function cycle(direction: number) {
    if (multiple) onIndexChange((index + direction + images.length) % images.length);
  }
  if (!image) return null;
  return createPortal(
    <dialog
      ref={lightbox}
      data-ui="chat-image-preview"
      data-message-control
      className={styles.lightbox}
      aria-label="Image preview"
      onClose={(event) => {
        // StrictMode cleanup may queue a close event before the modal reopens.
        if (!event.currentTarget.open) onClose();
      }}
      onCancel={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Escape") event.stopPropagation();
        if (multiple && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
          event.preventDefault();
          event.stopPropagation();
          cycle(event.key === "ArrowLeft" ? -1 : 1);
        }
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) event.currentTarget.close();
      }}
    >
      <div className={styles.toolbar}>
        <div className={styles.navigation}>
          {multiple ? (
            <button type="button" aria-label="Previous image" onClick={() => cycle(-1)}>
              <BackIcon />
            </button>
          ) : null}
          <span role="status" aria-live="polite" aria-atomic="true">
            Image {index + 1} of {images.length}
          </span>
          {multiple ? (
            <button type="button" aria-label="Next image" onClick={() => cycle(1)}>
              <ChevronIcon />
            </button>
          ) : null}
        </div>
        {openLink ? (
          <a
            className={styles["open-link"]}
            href={openLink}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open link
          </a>
        ) : null}
        <button
          type="button"
          aria-label="Close image preview"
          autoFocus
          onClick={() => lightbox.current?.close()}
        >
          <CloseIcon />
        </button>
      </div>
      <div className={styles.stage}>
        <ExpandedImage key={image.url} {...image} />
      </div>
    </dialog>,
    document.body,
  );
}
