"""Length scaling for analytical prototypes, not native lens prescriptions."""
import math
from .calculations import validate as validate_parameters
from .scene import validate_scene

LENGTH_PARAMETERS = frozenset(('source_width_mm','source_height_mm','reference_efl_mm',
    'pitch_x_mm','pitch_y_mm','cell_clear_width_mm','cell_clear_height_mm','cell_efl_mm',
    'relay_efl_mm','target_width_mm','target_height_mm','margin_mm'))
SOURCE_PARAMETERS = frozenset(('source_width_mm','source_height_mm'))

def validate_factor(factor):
    if isinstance(factor,bool) or not isinstance(factor,(int,float)) or not math.isfinite(factor) or not .01<=factor<=100:
        raise ValueError('缩放倍率须为0.01至100的有限数字')
    return float(factor)

def scale_design(parameters, scene, factor, source_mode='fixed'):
    factor=validate_factor(factor)
    if source_mode not in ('all','fixed'):raise ValueError('光源模式须为all或fixed')
    p=validate_parameters(parameters);s=validate_scene(scene)
    original_source=s['elements'][0];anchor_z=original_source['z_mm'];anchor_y=original_source['y_mm']
    for key in LENGTH_PARAMETERS:
        if source_mode=='fixed' and key in SOURCE_PARAMETERS:continue
        p[key]*=factor
    for element in s['elements']:
        element['z_mm']=anchor_z+(element['z_mm']-anchor_z)*factor
        element['y_mm']=anchor_y+(element['y_mm']-anchor_y)*factor
        for key in ('aperture_mm','width_mm','focal_mm','pitch_mm'):
            if key not in element:continue
            if source_mode=='fixed' and element['kind']=='source':continue
            element[key]*=factor
    return dict(parameters=validate_parameters(p),scene=validate_scene(s),
        scaling=dict(factor=factor,source_mode=source_mode,anchor=dict(z_mm=anchor_z,y_mm=anchor_y),
        wavelength_and_ray_angles_scaled=False,source_power_scaled=False,
        warnings=['这是参数与薄透镜场景缩放；未生成或修改LightTools/Zemax原生处方。',
                  '波长、源角域、总功率、效率、时序及配色预算保持；这些数值尚需新几何验证。',
                  '目标器件尺寸也随倍率改变；实际DMD/LCOS尺寸和机械接口需重新匹配。',
                  '缩放后的器件尺寸已改变，另存原型会解除原历史器件引用。']))

def scale_aspheric_coefficients(coefficients, factor):
    """A_m r^m sag terms in physical length units; normalized terms are excluded."""
    factor=validate_factor(factor)
    if not isinstance(coefficients,dict) or len(coefficients)>32:raise ValueError('系数须为最多32项的幂次字典')
    result={}
    for power,value in coefficients.items():
        if type(power) is not int or not 2<=power<=64:raise ValueError('幂次须为2至64的整数')
        if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value):raise ValueError('系数须为有限数字')
        scaled=value/factor**(power-1)
        if not math.isfinite(scaled):raise ValueError('缩放系数超出有限范围')
        result[power]=scaled
    return result
