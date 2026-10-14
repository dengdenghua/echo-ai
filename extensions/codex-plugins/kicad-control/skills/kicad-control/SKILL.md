---
name: kicad-control
description: Create, inspect, and edit KiCad schematics and PCBs on this Windows machine using official Python IPC, the plugin MCP, schematic file APIs, and KiCad CLI. Use for circuit design, PCB layout, ERC/DRC, Gerber, drill, and STEP exports.
---

# KiCad 电路设计控制

## 本机环境

- KiCad 10.0.6：`D:/Program Files/KiCad/10.0/`。
- CLI：`D:/Program Files/KiCad/10.0/bin/kicad-cli.exe`。
- 自动化 Python：`D:/AI/KiCadAutomation/.venv/Scripts/python.exe`。
- MCP：`D:/AI/KiCadAutomation/kicad_mcp_local.py`，服务器名 `kicad`。
- 验证资料：`D:/AI/KiCadAutomation/VERIFICATION.md` 和 `test-project/`。

## 工作原则

先确认项目版本、电源、接口、器件额定值、板框、安装孔和制造规则。修改前检查已有文件；较大改动使用命名清楚的项目副本。保持原理图位号、封装库标识、引脚号和网络名一致。

运行中的 PCB 编辑器优先使用官方 `kipy.KiCad()` IPC。先打开指定 `.kicad_pcb`，核对项目目录和板名后再写入；更新后重新获取对象，使用提交、更新和推送接口保留撤销能力，并显式保存。

原理图使用 `kicad_sch_api` 操作已保存文件。本地 MCP 可检查原理图和修改新副本中的元件值，但不提供实时原理图 IPC。编辑器存在未保存内容时，不覆盖其磁盘文件。

新板必须加载真实库封装，不用空对象代替封装。本机带有可离线构建的旧版 `pcbnew` Python 接口，但它不能修改已经打开的 PCB 文件。

先验证电气选择和引脚映射，再根据真实网络、线宽、间距和叠层布线。移动封装不会自动重新连接原有走线；几何检查通过也不能证明电气设计正确。

完成后保存并运行 ERC、带原理图一致性检查的 DRC，检查实际渲染效果，再从最终保存版本导出。报告剩余警告，不通过禁用检查来获得通过结果。

## MCP 范围

可用工具包括：`connect_kicad`、`get_board_info`、`list_footprints`、`set_footprint_value`、`move_footprint`、`add_board_text`、`save_board`、`inspect_schematic`、`set_schematic_value`。

坐标单位为毫米。PCB 和原理图的元件值是不同操作。本地 MCP 是小型适配器，不是自动布线器；其它功能使用官方 API 或 CLI，并在验证后再声称完成。

## 检查和导出

调用 CLI 时传递参数数组或正确引用包含空格的路径；修改命令参数前先查看相应 `--help`。

- `sch erc --format json --exit-code-violations -o <erc.json> <project.kicad_sch>`
- `pcb drc --schematic-parity --format json --exit-code-violations -o <drc.json> <project.kicad_pcb>`
- `sch export netlist --format kicadxml -o <net.xml> <project.kicad_sch>`
- `sch export pdf -o <schematic.pdf> <project.kicad_sch>`
- `pcb export gerbers -o <output-directory> <project.kicad_pcb>`
- `pcb export drill -o <output-directory> <project.kicad_pcb>`
- `pcb export step -o <model.step> <project.kicad_pcb>`

本地标签在网表中显示为 `/NAME`，PCB 必须保留这一准确名称。保留完整封装标识。分别检查未连接项为零、原理图一致性问题为零和 DRC 违规；查看报告中的 `ignored_checks`，并使用真实制造规则。

若 IPC 连接失败，检查 PCB 编辑器是否运行，以及“首选项 > 插件 > 启用 IPC API 服务器”。不要替换或重启不相关的打开项目。运行包版本记录在 `D:/AI/KiCadAutomation/requirements.lock.txt`。

## Echo integration

In Echo, discover the registered tools with `search_capabilities` before use. The MCP tool names carry the `mcp_kicad_` prefix; all arguments and operating rules above still apply. Read this skill and its references before changing a document.
