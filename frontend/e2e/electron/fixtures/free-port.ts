import { createServer } from "node:net";

/**
 * A loopback port nothing is listening on right now.
 *
 * Specs that let the shell spawn its Python backend pick the port this way,
 * so a dev server already holding a fixed port (another checkout's
 * ``runtime serve`` on 18000, say) cannot answer in the spawned backend's
 * place.
 */
export async function freeLoopbackPort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  if (!address || typeof address === "string") {
    throw new Error("no loopback port");
  }
  return address.port;
}
