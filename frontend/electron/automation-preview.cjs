/** Never substitute another window or the full desktop for a missing target. */
function selectPreviewSource(sources, request) {
  if (request.kind !== "desktop_window") return null;
  const windows = sources.filter(source => source.id?.startsWith("window:") && !source.thumbnail?.isEmpty());
  const exact = windows.find(source => source.id === request.id);
  if (exact) return exact;
  if (String(request.id || "").startsWith("window:")) return null;
  // Some OS accessibility APIs do not share desktopCapturer IDs. Only accept
  // one exact title match; ambiguous app names and partial titles are unsafe.
  const title = String(request.title || "").trim();
  const named = title ? windows.filter(source => source.name?.trim() === title) : [];
  return named.length === 1 ? named[0] : null;
}
module.exports = { selectPreviewSource };
