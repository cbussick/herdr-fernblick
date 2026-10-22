// The backend accepts only absolute VPS paths, never browser-relative URLs.
export function isLocalImagePath(value: string): boolean {
  return (
    value.startsWith("/") &&
    !value.startsWith("//") &&
    value.length <= 4096 &&
    // eslint-disable-next-line no-control-regex -- Reject control characters in filesystem paths.
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

export function localImageSource(destination: string, cwd?: string): string | undefined {
  let path = destination;
  try {
    path = decodeURIComponent(destination);
  } catch {
    // A literal percent sign is legal in a Linux filename.
  }
  if (!destination.startsWith("/")) {
    // Relative filesystem paths need the Pi session's directory. Never fall back
    // to the browser URL/server cwd or reinterpret schemes, network paths or ~.
    if (
      !cwd ||
      !isLocalImagePath(cwd) ||
      !path ||
      /^[a-z][a-z\d+.-]*:/i.test(path) ||
      /^[\\/~#?]/.test(path)
    )
      return;
    // Preserve ./ and ../ for filesystem resolution, including directory symlinks.
    path = `${cwd.replace(/\/+$/, "")}/${path}`;
  }
  if (isLocalImagePath(path)) return `/api/local-images?path=${encodeURIComponent(path)}`;
}
