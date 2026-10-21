// Local image destinations are absolute VPS paths, never browser-relative URLs.
export function isLocalImagePath(value: string): boolean {
  return (
    value.startsWith("/") &&
    !value.startsWith("//") &&
    value.length <= 4096 &&
    // eslint-disable-next-line no-control-regex -- Reject control characters in filesystem paths.
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

export function localImageSource(destination: string): string | undefined {
  if (!destination.startsWith("/")) return;
  let path = destination;
  try {
    path = decodeURIComponent(destination);
  } catch {
    // A literal percent sign is legal in a Linux filename.
  }
  if (isLocalImagePath(path)) return `/api/local-images?path=${encodeURIComponent(path)}`;
}
