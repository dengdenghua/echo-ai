# POP 复场分段交接

适用于在可验证的顺序光路中保存、修改并重新导入复杂场。读取 ZBF v1 时保留完整 pilot header、介质折射率、波长、网格与坐标基底；沿主光线的波束参考面不自动等于世界 XY 平面。

ZBF 的 sum(|Ex|²+|Ey|²) 是 W；转换辐照度时除以单元面积，不能再乘面积计算功率。文件输入仍受 POP 功率配置控制：UseTotalPower=False 选择峰值辐照度，并非关闭缩放。显式把输入总功率设置为交接文件内的实际功率，避免每段重置到 1 W；空场直接作为零功率处理，不进行归一化。

用同一输入比较连续传播与分段重启，分别核绝对功率、物理网格、强度、复场和整体相位。幅值、相位、网格间距和通光边界分别核验。形状相同不能证明功率正确，整体相位误差小也不能证明曲率和相位坐标全程一致。

POP 起始场在起始表面之前，终止输出在结束表面作用之后。折射或反射界面不能按同一面号盲目重复；无焦度、同介质参考面更适合做交接。含非顺序组件组时应先建立可核验的顺序等效路径，不能把全系统几何追迹成功当作 POP 成功。

光机改变整组刚体姿态时，内部处方可保持，但必须重新绑定世界原点、传播轴、局部横向基底和屏幕位置，并独立核对原生姿态。

本次局部验证：525 nm、轴上 1 W 高斯、256²，投影段在无焦度光阑处分段。读取交接功率重启后，功率相对差约 1.1e-15、复场相对差约 7.8e-9、强度相对差约 9.1e-10。错误峰值模式结果约 0.01147 W。数值是特定探针的结果，不是通用门槛；未验证完整照明链、DMD 衍射、激光相干谱宽、随机相位采样、屏幕或曝光散斑。

官方依据：[POP 设置与起止参考面](https://ansyshelp.ansys.com/public/Views/Secured/Zemax/v25101/en/OpticStudio_User_Guide/OpticStudio_Help/topics/Physical_Optics_Propagation.html)、[文件输入与功率定义](https://ansyshelp.ansys.com/public/Views/Secured/Zemax/v26102/en/OpticStudio_User_Guide/OpticStudio_Help/topics/File_defining_the_initial_beam.html)。项目具体证据保存在本地，迁移方法不包含个人模型和数据库。
