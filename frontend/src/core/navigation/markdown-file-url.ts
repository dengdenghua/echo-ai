// A path-shaped envelope survives Markdown's URL sanitizer without allowing
// file:, arbitrary drive-letter protocols, or scripts as browser navigation.
const PREFIX = "/__echo_file_reference__/";

export function encodeMarkdownFileURL(path: string) {
  return `${PREFIX}${encodeURIComponent(path)}`;
}

export function decodeMarkdownFileURL(url: string) {
  if (!url.startsWith(PREFIX)) return url;
  try {
    return decodeURIComponent(url.slice(PREFIX.length));
  } catch {
    return url;
  }
}
