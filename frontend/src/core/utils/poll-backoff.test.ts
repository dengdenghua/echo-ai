import { describe, expect, it } from "vitest";

import { unchangedBackoff } from "./poll-backoff";

describe("unchangedBackoff", () => {
  it("slows down while polls find the same data and snaps back on a change", () => {
    const same = { room: "quiet" };
    const query = { state: { dataUpdateCount: 1, data: same as unknown } };
    const poll = (data: unknown) => {
      query.state = { dataUpdateCount: query.state.dataUpdateCount + 1, data };
      return unchangedBackoff(query, 5000, 15_000);
    };

    expect(unchangedBackoff(query, 5000, 15_000)).toBe(5000);
    expect(poll(same)).toBe(10_000);
    expect(poll(same)).toBe(15_000);
    expect(poll(same)).toBe(15_000);
    expect(poll({ room: "someone wrote" })).toBe(5000);
  });

  it("does not count the same poll twice", () => {
    const query = { state: { dataUpdateCount: 1, data: 1 as unknown } };
    unchangedBackoff(query, 1000, 8000);
    query.state = { dataUpdateCount: 2, data: 1 };
    expect(unchangedBackoff(query, 1000, 8000)).toBe(2000);
    expect(unchangedBackoff(query, 1000, 8000)).toBe(2000);
  });
});
