# 固定角色 ID 统一

正式目录和 profile.id：eve、kane、raven、luna、shion、noah、zero、leon。显示名使用首字母大写的对应名字。

兼容映射集中在 runtime/execution/agents/aliases.py 和 frontend/src/core/agents/aliases.ts。general、coder、desktop_operator、vibe_selling、ecommerce_mind、market_researcher、echo_noah、aoi、admin 作为旧输入继续解析。授权角色 admin 不属于角色 ID，不修改。

注册列表和新角色配置使用正式 ID；历史任务的身份元数据不批量改写，侧栏显示归属通过别名合并。旧便捷工厂函数保留以兼容调用方。已运行的后端及旧任务仍可能持有旧角色对象，需要安全重新加载才能整体生效；未在本次操作中中断运行任务。

旧目录若被运行中的旧进程重新创建为日志目录，不代表角色配置迁回旧 ID，不应在任务运行时直接删除这些日志。echo_eve 等独立角色模板仍保留原模板身份与来源，不作为固定八人队列的正式角色。

定向验证覆盖八个身份及旧别名加载、角色列表、群聊：48 项通过；前端固定角色策略 3 项通过，TypeScript 和 Ruff 通过。既有大套件含其他未修复断言，不据此声称全项目回归通过。
