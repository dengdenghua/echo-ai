# 镜头知识与处方工具箱

三个可分别调用的 Skill：

- `lens-evidence-search`：查知识卡、ZMX 处方、LensVIEW 配置与逐页证据。
- `lens-patent-research`：查外部资源，核专利国家、实施例、变焦配置和原文。
- `lens-prescription-reuse`：核源文件 SHA，复制处方并生成设计交接记录。

包内只有工作流与标准库 Python 客户端，不含私人资料、数据库或绝对路径。它不提供新的 Zemax 控制 MCP；原生建模通过现有 Zemax Control 插件衔接。复制成功与原生验收分别记录。

本机配置放在 `~/.echo/lens-toolkit.local.json`：

```json
{"library_root":"<你的镜头知识库目录>"}
```

也可设置 `LENS_LIBRARY_ROOT`，或在每条命令最前面传 `--library <目录>`。Python 3.9+，仅依赖标准库。

```text
python skills/lens-evidence-search/scripts/library.py stats
python skills/lens-evidence-search/scripts/library.py search "双高斯" --kind cases --limit 5
python skills/lens-evidence-search/scripts/library.py search "专利" --kind resources
python skills/lens-evidence-search/scripts/library.py patent-links US2117252
python skills/lens-evidence-search/scripts/library.py prepare-case <案例ID> --output <全新目录>
```

新 Skill 或插件安装后，在新对话中核对发现状态。可直接输入 `$lens-evidence-search` 等名称。当地客户端尚未刷新时，脚本仍可直接运行；不要据安装文件存在声称当前会话已自动加载。
