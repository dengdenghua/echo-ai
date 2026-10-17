/**
 * Options for Electron's ``findInPage``. Its ``findNext`` means "begin a new
 * find session" and must be true for the first request of a query (Electron
 * docs, webContents.findInPage). The find bar's flag means the opposite, "a
 * follow-up of the same query"; passed through unchanged, a new query never
 * reported its matches and the bar read 无结果 under highlighted hits.
 */
export function electronFindOptions(options: {
  forward: boolean;
  /** The same query again (next / previous match). */
  findNext: boolean;
}): { forward: boolean; findNext: boolean } {
  return { forward: options.forward, findNext: !options.findNext };
}
