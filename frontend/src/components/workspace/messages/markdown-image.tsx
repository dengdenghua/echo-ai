import { useContext, type ImgHTMLAttributes } from "react";
import { FileReferenceScope } from "@/core/navigation/file-reference";
import { MessageImage } from "./routed-message-link";

/** Keep secondary markdown surfaces on the same collapsed, authenticated preview. */
export function MarkdownImage(props: ImgHTMLAttributes<HTMLImageElement>) {
  const scope = useContext(FileReferenceScope);
  return <MessageImage {...props} threadId={scope.threadId ?? ""} />;
}
