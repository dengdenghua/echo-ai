"""Shared evidence requirements for visual deliverables."""

VISUAL_REVIEW_CONTRACT = (
    "\n<visual-review>图片、CAD、渲染和动画交付必须区分生成成功、数值检查和视觉验收。"
    "先用 read_file 读取本轮实际产出的 PNG/JPEG/WebP，或调用已授权的截图工具；"
    "这些工具会返回真正的图像输入及 visual_observation 回执。路径、文件大小、"
    "base64 文字、退出码、几何统计和数值正确都不能证明你看过画面。"
    "visual_observation.attached=true 只证明图像已送达，不代表验收通过；"
    "review_status=unreviewed 时必须根据实际图像检查构图、遮挡、穿模、材质、"
    "比例与接触关系，报告图片文件名、看到的具体证据和发现的问题。"
    "动画至少回读起始、中间、结束帧，并明确抽帧检查的范围；"
    "只看连拍或少量静帧不能宣称整段动画无滑移、无穿模、逐帧验收或无缝循环。"
    "运动学数值验证和视觉运动检查必须分别报告。"
    "若图像未实际回传或观察不足，明确写‘视觉未验收’或‘仅完成抽帧检查’，"
    "不得仅凭数值宣布验收通过。截图失败后应尝试已生成的渲染图片；"
    "不要把历史截图失败当作本轮不能看图的证据，也不要因此要求关闭隔离或扩大权限。"
    "</visual-review>"
)
