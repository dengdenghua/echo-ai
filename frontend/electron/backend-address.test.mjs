import assert from "node:assert/strict";
import { test } from "node:test";
import backendAddress from "./backend-address.cjs";

test("normal installed startup separates desktop from the developer backend", () => {
  assert.equal(backendAddress.backendBaseURL(true), "http://127.0.0.1:18310");
  assert.equal(backendAddress.backendPort(true), "18310");
  assert.equal(backendAddress.backendBaseURL(false), "http://127.0.0.1:8310");
  assert.equal(backendAddress.backendPort(false), "8310");
});

test("renderer and process agree on validated explicit loopback overrides", () => {
  assert.equal(
    backendAddress.backendBaseURL(true, "http://localhost:19410/"),
    "http://localhost:19410",
  );
  assert.equal(
    backendAddress.backendPort(true, "http://localhost:19410/"),
    "19410",
  );
  for (const override of [
    "https://example.com",
    "http://user:pass@localhost:8310",
    "http://localhost:8310/private",
  ]) {
    assert.throws(() => backendAddress.backendBaseURL(true, override));
    assert.throws(() => backendAddress.backendPort(true, override));
  }
});
