import { forwardRef, useRef, useState } from "react";

/** A real textarea keeps the browser's IME and paste events intact. Only committed text is sent. */
export const PhoneKeyboard = forwardRef<
  HTMLTextAreaElement,
  {
    disabled: boolean;
    onEdit: (command: string, text?: string) => void;
  }
>(({ disabled, onEdit }, ref) => {
  const composing = useRef(false);
  const [focused, setFocused] = useState(false);
  const commit = (element: HTMLTextAreaElement) => {
    if (!composing.current && element.value) {
      onEdit("insert", element.value);
      element.value = "";
    }
  };
  return (
    <div className="relative flex min-h-7 items-center justify-center text-[11px] text-slate-500">
      <span aria-hidden="true">
        {focused
          ? "键盘已连接 · 可直接输入或粘贴 · Esc 返回"
          : "点击手机画面后，直接用键盘输入"}
      </span>
      <textarea
        ref={ref}
        aria-label="手机键盘输入"
        title="直接输入到手机；支持中文输入法、粘贴、退格、方向键和 Ctrl+A"
        disabled={disabled}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        className="absolute bottom-0 left-1/2 h-px w-px resize-none opacity-0"
        onFocus={() => setFocused(true)}
        onBlur={(event) => {
          setFocused(false);
          composing.current = false;
          event.currentTarget.value = "";
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={(event) => {
          composing.current = false;
          commit(event.currentTarget);
        }}
        onInput={(event) => commit(event.currentTarget)}
        onPaste={(event) => {
          event.preventDefault();
          const value = event.clipboardData.getData("text/plain");
          if (value) onEdit("insert", value);
        }}
        onKeyDown={(event) => {
          if (
            composing.current ||
            event.nativeEvent.isComposing ||
            event.keyCode === 229
          )
            return;
          let command: string | undefined;
          if (
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === "a"
          )
            command = "select_all";
          else if (!event.ctrlKey && !event.metaKey && !event.altKey) {
            command = (
              {
                Backspace: "delete_backward",
                Delete: "delete_forward",
                ArrowLeft: "move_left",
                ArrowRight: "move_right",
                Enter: "enter",
                Escape: "back",
              } as Record<string, string>
            )[event.key];
          }
          if (command) {
            event.preventDefault();
            onEdit(command);
          }
        }}
      />
    </div>
  );
});
PhoneKeyboard.displayName = "PhoneKeyboard";
