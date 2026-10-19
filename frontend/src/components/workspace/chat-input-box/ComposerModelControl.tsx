import type { ChatInputBoxProps } from "../chat-input-box";
import { CodeBuddyModelControl } from "../codebuddy-model-control";
import { CoderEngineControl } from "../coder-engine-control";
import { ModelPicker, type PickerModel } from "../model-picker";
import { UnifiedModelControl } from "../unified-model-control";

type Props = Pick<
  ChatInputBoxProps,
  | "executionEngine"
  | "onExecutionEngineChange"
  | "modelProfileControl"
  | "modelName"
  | "onModelChange"
  | "onModelSwitchNotice"
  | "reasoningEffort"
  | "onReasoningEffortChange"
> & {
  models: PickerModel[];
  disabled: boolean;
  selectedValue?: string;
  onNativeModelChange: (value: string) => void;
};

export function ComposerModelControl({
  executionEngine,
  onExecutionEngineChange,
  modelProfileControl,
  modelName,
  onModelChange,
  onModelSwitchNotice,
  reasoningEffort,
  onReasoningEffortChange,
  models,
  disabled,
  selectedValue,
  onNativeModelChange,
}: Props) {
  if (onExecutionEngineChange)
    return (
      <UnifiedModelControl
        models={models}
        engine={executionEngine ?? "echo"}
        value={modelName}
        disabled={disabled}
        onEngineChange={onExecutionEngineChange}
        onChange={onModelChange}
        reasoningEffort={reasoningEffort}
        onReasoningEffortChange={onReasoningEffortChange}
      />
    );
  return executionEngine === "codebuddy" ? (
    <CodeBuddyModelControl
      value={modelName}
      onChange={onModelChange}
      disabled={disabled}
    />
  ) : modelProfileControl && executionEngine !== "opencode" ? (
    <div className="composer-footer__model min-w-0">
      <CoderEngineControl
        systemModels={models}
        disabled={disabled}
        executionEngine={executionEngine}
        value={modelName}
        onChange={onModelChange}
        onEffectiveModelChange={onModelSwitchNotice}
        reasoningEffort={reasoningEffort}
        onReasoningEffortChange={onReasoningEffortChange}
      />
    </div>
  ) : (
    <div className="composer-footer__model min-w-0">
      <ModelPicker
        models={models}
        engineSource={executionEngine === "opencode" ? "opencode" : undefined}
        // Pass the raw modelName so the picker sees the "auto"
        // sentinel — selectedModel falls back to models[0]
        // when name doesn't match, which would mask the auto state.
        value={modelName ?? selectedValue}
        onChange={onNativeModelChange}
        reasoningEffort={reasoningEffort}
        reasoningEffortDisabled={disabled}
        onReasoningEffortChange={
          executionEngine === "opencode" ? undefined : onReasoningEffortChange
        }
      />
    </div>
  );
}
