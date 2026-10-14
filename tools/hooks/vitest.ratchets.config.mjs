// Fast lane for the frontend source-scan ratchet, used by
// tools/hooks/commit_tree_gates.py. Plain Node: no jsdom and no setup files,
// which take ~25 s of the full config's startup and are not needed to count
// type assertions. No imports, so it loads from outside frontend/.
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../frontend");

export default {
  root: frontend,
  test: {
    environment: "node",
    include: ["src/test/type-assertion-ratchet.test.ts"],
    watch: false,
  },
};
