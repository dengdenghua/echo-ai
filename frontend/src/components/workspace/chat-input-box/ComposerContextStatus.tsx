import {
  ContextCompressorControl,
  type ContextCompressorProps,
} from "../context-compressor";
import { EvolutionIndicator } from "../evolution-indicator";
import { PreviewRefreshIndicator } from "../preview-refresh-indicator";
import type { ContextCompressionState } from "../use-context-compression";

export function ComposerContextStatus({
  contextProps,
  contextState,
}: {
  contextProps: ContextCompressorProps;
  contextState: ContextCompressionState;
}) {
  return (
    <div
      data-testid="composer-context-controls"
      className="inline-flex shrink-0 items-center gap-1"
    >
      <EvolutionIndicator compact quiet />
      <PreviewRefreshIndicator />
      <ContextCompressorControl
        {...contextProps}
        state={contextState}
        showPercentage
      />
    </div>
  );
}
