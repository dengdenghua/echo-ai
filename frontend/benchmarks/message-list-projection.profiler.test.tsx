import { describe, expect, test } from "vitest";

import type { Message } from "@/core/api/types";
import { groupMessages } from "@/core/messages/utils";

import { deriveSubagentsFromMessages } from "@/components/workspace/messages/inline-subagent-cards";
import { partitionMessageGroupsIntoTurns } from "@/components/workspace/messages/message-list-turns";

const TURNS = Number(process.env.PROFILER_TURNS ?? 500);
const RUNS = 20;

function messages(): Message[] {
  const rows: Message[] = [];
  for (let turn = 0; turn < TURNS; turn += 1) {
    rows.push({ id: `human-${turn}`, type: "human", content: `request ${turn}` } as Message);
    rows.push({
      id: `assistant-${turn}`,
      type: "ai",
      content: `settled answer ${turn}`,
      additional_kwargs: { message_kind: "answer" },
    } as Message);
  }
  return rows;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

describe("MessageList projection profiler", () => {
  test("times group, turn partition and subagent derivation", () => {
    const rows = messages();
    const groupTimes: number[] = [];
    const partitionTimes: number[] = [];
    const subagentTimes: number[] = [];
    let groupCount = 0;
    let turnCount = 0;

    for (let run = 0; run < RUNS; run += 1) {
      const groupStarted = performance.now();
      const groups = groupMessages(rows, (group) => group);
      groupTimes.push(performance.now() - groupStarted);
      groupCount = groups.length;

      const partitionStarted = performance.now();
      const turns = partitionMessageGroupsIntoTurns(groups);
      partitionTimes.push(performance.now() - partitionStarted);
      turnCount = turns.length;

      const subagentStarted = performance.now();
      for (const turn of turns) {
        const turnMessages: Message[] = [];
        for (const index of turn.groupIndexes) {
          turnMessages.push(...groups[index]!.messages);
        }
        deriveSubagentsFromMessages(turnMessages);
      }
      subagentTimes.push(performance.now() - subagentStarted);
    }

    const report = {
      turns: TURNS,
      messages: rows.length,
      groupCount,
      turnCount,
      groupMedianMs: median(groupTimes),
      partitionMedianMs: median(partitionTimes),
      subagentMedianMs: median(subagentTimes),
    };
    console.log(`[message-list-projection] ${JSON.stringify(report)}`);
    expect(groupCount).toBeGreaterThan(0);
    expect(turnCount).toBeGreaterThan(0);
  });
});
