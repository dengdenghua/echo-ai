export const westock = {
  id: "westock-mcp",
  name: "westock-mcp",
  name_zh: "腾讯股票",
  description: "腾讯股票行情",
  description_zh: "腾讯股票行情",
  type: "mcp" as const,
  auth_mode: "token",
  source: "connector" as const,
  provider_id: "",
  mcp_servers: ["westock-mcp"],
  skill_count: 3,
  examples_zh: [],
  installed: true,
  enabled: false,
  version: "1.0.0",
};

export const cliCapability = {
  ...westock,
  id: "cli-one",
  name: "CLI One",
  name_zh: "CLI One",
  description: "CLI device flow",
  description_zh: "CLI 设备流",
  type: "cli" as const,
  has_cli_auth: true,
  mcp_servers: [],
};

export const freebuffCapability = {
  ...cliCapability,
  id: "freebuff-cli",
  name: "Freebuff CLI",
  name_zh: "Freebuff 本地智能体",
  description: "Official Freebuff CLI",
  description_zh: "官方 Freebuff CLI",
};

export const activeDeviceFlow = {
  flow_id: "flow-a",
  connector_id: "cli-one",
  verification_uri: "https://example.test/device",
  user_code: "ABCD-EFGH",
  expires_in: 240,
  code_embedded_in_uri: false,
  message: "请在浏览器完成授权",
};

export const browserPlugin = {
  id: "browser",
  name: "Browser",
  name_zh: "Browser",
  description: "Control the in-app browser",
  description_zh: "控制 in-app 浏览器",
  type: "plugin" as const,
  auth_mode: "none",
  source: "codex_plugin" as const,
  author: "OpenAI",
  mcp_servers: [],
  skill_count: 1,
  installed: false,
  enabled: false,
  version: "26.810.52044",
};

export const documentsPlugin = {
  ...browserPlugin,
  id: "documents",
  name: "Documents",
  name_zh: "文档",
  description: "Create and edit documents",
  description_zh: "创建和编辑文档",
};

export const sheetsPlugin = {
  ...browserPlugin,
  id: "spreadsheets",
  name: "Spreadsheets",
  name_zh: "表格",
  description: "Create spreadsheets",
  description_zh: "创建电子表格",
};

export const openCodeZen = {
  ...westock,
  id: "opencode-zen",
  name: "OpenCode Zen Models",
  name_zh: "OpenCode Zen 模型适配器",
  description: "Direct Zen model API",
  description_zh: "直连 Zen 模型 API",
  type: "plugin" as const,
  mcp_servers: [],
  model_provider: {
    entry_id: "opencode-zen",
    protocol: "openai-compatible",
    base_url: "https://opencode.ai/zen/v1",
    dashboard_url: "https://opencode.ai/zen",
    api_key_label_zh: "OpenCode Zen API Key",
    login_cta_zh: "登录 OpenCode Zen 并获取 API Key",
    connection_note_zh: "直连模型 API，不安装或检测 OpenCode CLI",
    model_list_label_zh: "当前免费模型",
    free_models: ["big-pickle", "mimo-v2.5-free"],
    privacy_notices_zh: ["免费模型可能记录请求，不要发送机密数据。"],
  },
};

export const freebuff2apiCommunity = {
  ...openCodeZen,
  id: "freebuff2api-community",
  name: "Freebuff2API Community Adapter",
  name_zh: "Freebuff2API 社区适配器",
  description_zh: "社区适配器，非 Freebuff 官方服务或官方插件。",
  model_provider: {
    entry_id: "freebuff2api-community",
    display_name_zh: "Freebuff2API 社区适配器",
    protocol: "openai-compatible",
    base_url: "https://open.freebuff.app/v1",
    dashboard_url: "https://open.freebuff.app",
    configurable_base_url: true,
    api_key_label_zh: "Freebuff2API API Key",
    login_cta_zh: "打开社区服务并获取 API Key",
    connection_note_zh: "第三方社区模型网关，不安装 Freebuff CLI",
    model_list_label_zh: "模型将在连接时动态读取",
    free_models: [],
    privacy_notices_zh: [
      "这是第三方社区适配器，不是 Freebuff 官方服务或官方插件。",
    ],
  },
};
