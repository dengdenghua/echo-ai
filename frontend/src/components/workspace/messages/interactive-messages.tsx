import type { Message } from "@/core/api/types";
import { InlineVisualMessages } from "./inline-visual";
import { NativeUIMessages } from "./native-ui";

export function InteractiveMessages({ messages }: { messages: Message[] }) {
  return (
    <>
      <InlineVisualMessages messages={messages} />
      <NativeUIMessages messages={messages} />
    </>
  );
}
