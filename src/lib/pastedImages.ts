const supportedClipboardImageTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export function isSupportedClipboardImageType(mimeType: string) {
  return supportedClipboardImageTypes.has(mimeType.toLowerCase());
}

export function pastedImageMarkdown(relativePath: string, altText = "Pasted image") {
  const escapedAlt = altText.replace(/([\\\]])/g, "\\$1");
  const encodedPath = relativePath
    .split("/")
    .map((segment) => (segment === ".." ? segment : encodeURIComponent(segment)))
    .join("/");
  return `![${escapedAlt}](${encodedPath})`;
}
