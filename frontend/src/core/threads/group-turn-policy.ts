import { objectLike } from "@/core/utils/guards";

export function queuesGroupInput(context: unknown): boolean {
  return objectLike(context)?.group_conversation === true;
}
