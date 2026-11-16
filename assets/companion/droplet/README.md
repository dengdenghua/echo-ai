# Echo 水滴动画体验版

Blender 源文件：`Echo-Pearl-Droplet.blend`。独立制作，未改动本机正在打开的结构工程。

## 角色与绑定

- 珍珠白水滴、浅青色边缘、深色椭圆眼睛、小手和小脚。
- 七根骨骼：root、body、tip、hand.L / R、foot.L / R。
- 形态键：眼睛 Blink、身体 Squash / Stretch；由骨架上的 blink / squash / stretch 属性驱动。
- 在 Blender Action Editor 选择 `Echo_idle`、`Echo_greet`、`Echo_drag`、`Echo_land`、`Echo_work`、`Echo_wait`、`Echo_success`。
- 每秒 24 帧，合计 408 帧。Cycles CPU 渲染使用四个线程。

## 运行方式

AI 和 OS 的 Electron 玩伴使用同一套透明 WebP 图集和 Canvas 播放器。运行时无需 Blender、三维引擎或独立 Agent。透明动画 WebP 文件用于查看和复用；程序使用可逐帧控制的图集，支持单次动作、暂停及状态切换。

真实任务记录和服务器确认的执行事件驱动工作、等待确认和完成动作。点击触发打招呼并打开原对话入口；超过拖拽阈值后播放拉伸，释放后回弹。完成动作对同一任务结果只播放一次。断线停止工作动作；恢复连接后重新读取真实状态。减少动态效果设置和动画加载失败均有降级。

Linux 保留 TV 对话面板和遥控器交互。此轮是本机体验版，不包含公网部署、手机真机验收或重新签名的完整安装器。

## 可再生文件

`build_droplet.py` 创建模型、材质、绑定和动作；`render_clips.py` 渲染各动作；`export_atlas.py` 生成透明动画及运行时图集并验证透明通道、裁切、循环接缝和逐帧回读。渲染完成且验证后可清理 `frames/`，保留源文件、脚本和验证结果。
