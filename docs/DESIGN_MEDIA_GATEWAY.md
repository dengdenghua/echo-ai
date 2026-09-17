# 设计生成能力

设计仍是统一入口，Agent 按任务调用 generate_image / generate_video，无须切换图片或视频模式。没有新增独立插件页面。

服务器设置 ECHO_MEDIA_BASE_URL（含 /v1）、ECHO_MEDIA_API_KEY、ECHO_IMAGE_MODEL、ECHO_VIDEO_MODEL。可选 ECHO_IMAGE_MODELS、ECHO_VIDEO_MODELS 为逗号分隔的额外可选模型 ID。密钥不传给前端和模型；用户可在需求中指定已启用的模型。

本次定义的 Echo 网关协议（不是对现有 Agnes 接口的保证）：

- POST /images/generations：model、prompt、size、n、可选 image；返回 data 数组，每项包含 url。
- POST /videos/generations：model、prompt、width、height、seconds、可选 image；返回 id/task_id、status，可选 progress、video_url/url。
- GET /videos/{task_id}：查询同一任务，返回上述任务字段。当前为异步提交，不在工具内部阻塞轮询。

网关需实现账号授权、任务归属校验、模型参数转换及计费。当前模型允许列表为服务器级，不是用户级。尚未提供模型能力发现、取消任务、幂等键或 base64 图片响应。

设计首页输入框提供图片、视频模型选择，列表由设计能力接口返回服务器允许列表，不暴露密钥或服务地址。默认“自动”使用服务器默认模型。显式选择随 design_capabilities 的 image_model/video_model 字段进入任务元数据，在生成工具的会话上下文中优先于 Agent 的 model 参数。后台再次检查模型允许列表，已移除的模型不会自动替换。缺少会话上下文的外部调用仍依赖显式 model 参数；主对话模型与生成模型独立。当前仅首页提供选择控件。

只要设置 Echo 网关地址或密钥，就优先使用该网关；配置不全、请求失败时不自动转发其他服务商、不自动重发生成请求。现有 Agnes 缺失脚本分支没有在此修复。

需要重新加载后端并配置符合上述协议的网关才能真实生成。本地模拟测试不能证明服务商生成成功。
