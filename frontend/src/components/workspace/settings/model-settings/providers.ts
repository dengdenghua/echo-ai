// ── Provider presets ────────────────────────────────────────────
//
// Each preset auto-fills base URL + protocol when selected. Optional
// Implementation note.
// API key input · ``suggestedModels`` shows a small hint below the
// Model ID field so users don't have to remember model names.
//
// Compatibility note · all entries work with Echo's native
// tool_use pipeline as long as the backing model supports function
// calling (see docs/custom-models.md for per-provider gotchas).
export interface ProviderPreset {
  label: string;
  value: string;
  baseUrl: string;
  protocol: "openai" | "anthropic";
  consoleUrl?: string;
  suggestedModels?: string[];
}

export const PROVIDERS: readonly ProviderPreset[] = [
  // Implementation note.
  {
    label: "OpenAI",
    value: "openai",
    baseUrl: "https://api.openai.com/v1",
    protocol: "openai",
    consoleUrl: "https://platform.openai.com/api-keys",
    suggestedModels: ["gpt-4o-mini", "gpt-4o", "o1", "o3-mini"],
  },
  {
    label: "Anthropic (Claude)",
    value: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    protocol: "anthropic",
    consoleUrl: "https://console.anthropic.com/",
    suggestedModels: [
      "claude-sonnet-4-6-20250514",
      "claude-haiku-4-5-20251001",
      "claude-opus-4-7-20250805",
    ],
  },
  {
    label: "Google Gemini",
    value: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    protocol: "openai",
    consoleUrl: "https://aistudio.google.com/apikey",
    suggestedModels: ["gemini-2.5-flash", "gemini-2.5-pro"],
  },
  {
    label: "xAI (Grok)",
    value: "xai",
    baseUrl: "https://api.x.ai/v1",
    protocol: "openai",
    consoleUrl: "https://console.x.ai/",
    suggestedModels: ["grok-4-mini", "grok-4"],
  },
  {
    label: "DeepSeek",
    value: "deepseek",
    baseUrl: "https://api.deepseek.com/v1",
    protocol: "openai",
    consoleUrl: "https://platform.deepseek.com/",
    suggestedModels: ["deepseek-chat", "deepseek-reasoner"],
  },

  // Implementation note.
  {
    label: "Moonshot · Kimi",
    value: "kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    protocol: "openai",
    consoleUrl: "https://platform.moonshot.cn/console/api-keys",
    suggestedModels: [
      "kimi-k2-0711-preview",
      "moonshot-v1-128k",
      "moonshot-v1-32k",
    ],
  },
  {
    label: "Kimi Coding",
    value: "kimi-coding",
    baseUrl: "https://api.kimi.com/coding/v1",
    protocol: "openai",
    consoleUrl: "https://platform.moonshot.cn/console/api-keys",
    suggestedModels: ["K2.7-Code", "kimi-k2.7-code"],
  },
  {
    label: "Zhipu · GLM",
    value: "zhipu",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    protocol: "openai",
    consoleUrl: "https://bigmodel.cn/usercenter/apikeys",
    suggestedModels: ["glm-4.6", "glm-4-flash", "glm-4-plus", "glm-4v-plus"],
  },
  {
    label: "MiniMax",
    value: "minimax",
    baseUrl: "https://api.minimaxi.com/v1",
    protocol: "openai",
    consoleUrl:
      "https://platform.minimaxi.com/user-center/basic-information/interface-key",
    suggestedModels: ["MiniMax-M2", "abab7-chat-preview"],
  },
  {
    label: "Alibaba Cloud · Tongyi Qwen (Qwen)",
    value: "aliyun",
    // NB · must be ``compatible-mode`` · DashScope native proto
    // does not support the standard ``tools`` field shape.
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    protocol: "openai",
    consoleUrl: "https://bailian.console.aliyun.com/?tab=model#/api-key",
    suggestedModels: [
      "qwen-max-latest",
      "qwen-plus",
      "qwen-turbo",
      "qwen3-max",
      "qvq-max-latest",
    ],
  },
  {
    label: "Tencent Cloud · Hunyuan",
    value: "tencent",
    baseUrl: "https://api.hunyuan.cloud.tencent.com/v1",
    protocol: "openai",
    consoleUrl: "https://console.cloud.tencent.com/hunyuan/api-key",
    suggestedModels: ["hunyuan-turbos-latest", "hunyuan-large", "hunyuan-lite"],
  },
  {
    label: "Volcano Engine · Doubao (Ark)",
    value: "volcengine",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    protocol: "openai",
    consoleUrl: "https://console.volcengine.com/ark",
    suggestedModels: [
      "doubao-pro-256k",
      "doubao-1-5-pro-256k",
      "doubao-pro-32k",
    ],
  },
  {
    label: "Baichuan",
    value: "baichuan",
    baseUrl: "https://api.baichuan-ai.com/v1",
    protocol: "openai",
    consoleUrl: "https://platform.baichuan-ai.com/console/apikey",
    suggestedModels: ["Baichuan4", "Baichuan3-Turbo"],
  },
  {
    label: "01.AI · Yi",
    value: "lingyiwanwu",
    baseUrl: "https://api.lingyiwanwu.com/v1",
    protocol: "openai",
    consoleUrl: "https://platform.lingyiwanwu.com/",
    suggestedModels: ["yi-lightning", "yi-large"],
  },
  {
    label: "StepFun",
    value: "stepfun",
    baseUrl: "https://api.stepfun.com/v1",
    protocol: "openai",
    consoleUrl: "https://platform.stepfun.com/",
    suggestedModels: ["step-2-mini", "step-1-8k"],
  },
  {
    label: "SiliconFlow",
    value: "siliconflow",
    baseUrl: "https://api.siliconflow.cn/v1",
    protocol: "openai",
    consoleUrl: "https://cloud.siliconflow.cn/account/ak",
    suggestedModels: [
      "deepseek-ai/DeepSeek-V3",
      "Qwen/Qwen3-Coder-480B-A35B-Instruct",
    ],
  },
  {
    label: "Baidu · Qianfan",
    value: "qianfan",
    baseUrl: "https://qianfan.baidubce.com/v2",
    protocol: "openai",
    consoleUrl:
      "https://console.bce.baidu.com/qianfan/ais/console/applicationConsole/application",
    suggestedModels: ["ernie-4.5-turbo-128k", "ernie-x1-turbo-32k"],
  },

  // Implementation note.
  {
    label: "Ollama (local)",
    value: "ollama",
    baseUrl: "http://localhost:11434/v1",
    protocol: "openai",
    consoleUrl: "https://ollama.com",
    suggestedModels: [
      "llama3.3:70b",
      "qwen3:7b",
      "qwen3-coder:32b",
      "deepseek-r1:7b",
    ],
  },
  {
    label: "LM Studio (local)",
    value: "lmstudio",
    baseUrl: "http://localhost:1234/v1",
    protocol: "openai",
  },
  {
    label: "OpenRouter (200+ models)",
    value: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    protocol: "openai",
    consoleUrl: "https://openrouter.ai/keys",
  },
  {
    label: "Agnes AI (gateway)",
    value: "agnes",
    baseUrl: "https://apihub.agnes-ai.com/v1",
    protocol: "openai",
    consoleUrl: "https://agnes-ai.com/dashboard",
    suggestedModels: [
      "agnes-2.0-flash",
      "agnes-1.5-flash",
      "agnes-image-2.1-flash",
      "agnes-image-2.0-flash",
      "agnes-video-v2.0",
    ],
  },
  { label: "Custom", value: "custom", baseUrl: "", protocol: "openai" },
] as const;

export const PROTOCOLS = [
  { label: "OpenAI", value: "openai" },
  { label: "Anthropic", value: "anthropic" },
] as const;
