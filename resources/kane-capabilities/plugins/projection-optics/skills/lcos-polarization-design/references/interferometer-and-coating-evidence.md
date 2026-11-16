# 干涉仪偏振像差与分区膜证据

加线偏振片改变输入态，但不普遍消除薄膜相位或等价无膜普通追迹。合成被动对角Jones J(q)=diag(exp(i·2π·a·q²),1)，纯输入(1,0)仍有相对主光线的Ex瞳孔相位变化，功率恒定；这只能证明普遍等价不成立，不能代真实干涉仪。对照需原处方、输入Stokes/方向、参考与测量臂复响应、加片通量/曝光/条纹可见度及漂移。模型仅含部分支路时不称整台或高NA宽谱验证。

单电场分量沿瞳孔相对参考相位与同光线Ex/Ey相位差分别核；零分量相位不定。[Ansys相位像差定义](https://ansyshelp.ansys.com/public/Views/Secured/Zemax/v251/en/OpticStudio_User_Guide/OpticStudio_Help/topics/Phase_Aberration.html)给出此区分。[系统偏振分析](https://ansyshelp.ansys.com/public/Views/Secured/Zemax/v251/en/OpticStudio_User_Guide/OpticStudio_Help/topics/Polarization_System_Explorer.html)区分仅强度加权与考虑向量相位的分析；使用实际版本/功能，不能用当前说明回证旧截图。

分区膜分别绑定外形、有效口径、区域边界/公差、表面编号、方向标记、入射介质/角度和光束足迹。组合面T与单面T分开；Tavg保留谱权重及偏振定义。仅在同谱角、等正交输入功率、对角无串偏/去偏振模型中以Tp/Ts给透射选择性，非偏振输入的DOLP为(Tp−Ts)/(Tp+Ts)。它们不是源实测偏振或整机CR；缺吸散时不能由低Ts推出高Rs，缺相位时不能补全Jones矩阵。

## 端到端相位标定

关闭gamma只取消指定传递环节，不能自动证明灰度—电压或灰度—相位线性。绑定液晶类型/厚度与驱动模式、波长、AOI、输入态/分析器、温度和稳定时序，直接标定目标端口phi(g)及幅度A(g)；用实际曲线反解相移，再量化灰度/漂移误差。合成identity gamma仍可有V/Vmax=(g/gmax)^2及phi=2pi(g/gmax)^2，否定通用线性假设，不能代硬件实验。

相同归一偏振不证明恒定功率；Eout(g)=a(g)exp(i phi(g))Ein仍可幅度随灰度变化。椭圆输入优于线输入仅在实际液晶/玻片/Jones与响应范围内评价。[Hamamatsu相位方法](https://lcos-slm.hamamatsu.com/us/en/learn/technical_information/characteristics.html)给特定LCOS交叉检偏I=(Imax−Imin)sin²(phi/2)+Imin；单强度反解有分支与2pi歧义，需展开/已知序列及幅度校准，不能把其型号示例当历史TN通用参数。Mach–Zehnder图处理还需相干双臂相对相位、参考功率/条纹可见度和受控曝光/漂移。

同平面主光线折转或纯局部S/P不证明全锥保偏。分别追离轴局部基底、复界面响应与匀光多次全反射；没有谱角/混合源和接受域证据时，PCS位置/去除只作为条件架构候选。3D/2D通量比较另含眼镜、银幕和时间复用测量链。
