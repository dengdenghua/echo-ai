# Repeated answer rendering regression

The reported Eight Sleep trend answer existed once in the durable log (912
characters, one completed item). Its streamed deltas also totaled 912
characters. The browser displayed the answer four times, with a missing phrase
in the first copy.

Two client-side defects interacted:

- Stream buffers were transferred away from their source item and mutated.
  The reconnect drift probe and React state fold can both reduce the same base;
  the first fold could consume chunks needed by the second fold.
- When a completed snapshot differed from the damaged draft, the reducer
  appended the entire snapshot as if it were a delta. Repeated synchronization
  kept appending another complete answer.

Buffers now use immutable persistent chunk chains, including reasoning blocks.
Each prior state remains readable and independently reducible. Nonempty
terminal snapshots replace the streamed draft; they never concatenate two full
versions. Empty legacy snapshots still preserve buffered text. No text-based
deduplication is applied to intentional repetition in model output.

Validation: reducer, replay, realtime hook and adapter suites passed (194 tests);
TypeScript passed. Regression tests cover double folds from one base, repeated
completion snapshots with missing text, shorter final corrections and intentional
repeated words.

The original browser page was reloaded with no unsent draft. The reported
answer now renders once, and the missing phrase about better sleep data is
restored. No conversation records were modified and no model regeneration was
performed.
