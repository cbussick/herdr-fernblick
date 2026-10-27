import { useId } from "react";
import { scoutArtwork } from "./scoutArtwork";
import styles from "./ScoutLogo.module.css";

export function ScoutLogo({ animated = false }: { animated?: boolean }) {
  const id = useId();
  const goggleClip = `${id}-goggles`;
  return (
    <svg
      className={styles.logo}
      viewBox={`0 0 ${scoutArtwork.width} ${scoutArtwork.height}`}
      role="img"
      aria-labelledby={id}
      fillRule="evenodd"
      data-animated={animated || undefined}
    >
      <title id={id}>Fernblick</title>
      <defs>
        <clipPath id={goggleClip}>
          <path d={scoutArtwork.goggles} clipRule="evenodd" />
        </clipPath>
      </defs>
      {scoutArtwork.layers.map((layer) => (
        <path key={layer.id} data-part={layer.id} fill={layer.fill} d={layer.path} />
      ))}
      {/* Clip only at the outer silhouette; the foreground rim covers pupils.
          Clipping pupils at the white eye edge creates a double-antialiased halo. */}
      <g clipPath={`url(#${goggleClip})`}>
        <g className={styles.pupils} fill="#17374f" data-part="pupils">
          {scoutArtwork.pupils.map((pupil) => (
            <ellipse key={pupil.cx} {...pupil} />
          ))}
        </g>
      </g>
      <path
        data-part="goggle-rim"
        fill="#196daa"
        d={`${scoutArtwork.goggles} ${scoutArtwork.eyes}`}
      />
    </svg>
  );
}
