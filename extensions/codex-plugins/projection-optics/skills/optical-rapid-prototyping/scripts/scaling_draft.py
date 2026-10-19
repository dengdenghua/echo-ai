"""Scale a portable workbench prototype offline; no original/native files modified."""
import argparse,copy,json,math
from pathlib import Path

def scale(payload,factor,source_mode='fixed'):
    if isinstance(factor,bool) or not isinstance(factor,(int,float)) or not math.isfinite(factor) or not .01<=factor<=100:raise ValueError('factor must be finite, 0.01..100')
    if source_mode not in ('fixed','all'):raise ValueError('source_mode must be fixed or all')
    if not isinstance(payload,dict) or payload.get('schema')!='optics-workbench.prototype' or payload.get('schema_version')!=1:raise ValueError('Expected exported prototype schema v1')
    out=copy.deepcopy(payload);p=out['project'];params=p['parameters']
    lengths=['source_width_mm','source_height_mm','reference_efl_mm','pitch_x_mm','pitch_y_mm','cell_clear_width_mm','cell_clear_height_mm','cell_efl_mm','relay_efl_mm','target_width_mm','target_height_mm','margin_mm']
    for key in lengths:
        if source_mode=='fixed' and key in ['source_width_mm','source_height_mm']:continue
        value=params[key]
        if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value):raise ValueError('Invalid length '+key)
        params[key]*=factor
    scene=p.get('scene')
    if scene:
        if scene.get('schema_version')!=1 or scene.get('units')!='mm':raise ValueError('Expected scene v1 in mm')
        sources=[e for e in scene['elements'] if e['kind']=='source']
        if len(sources)!=1:raise ValueError('Expected one source anchor')
        z,y=sources[0]['z_mm'],sources[0].get('y_mm',0)
        for e in scene['elements']:
            e['z_mm']=z+(e['z_mm']-z)*factor;e['y_mm']=y+(e.get('y_mm',0)-y)*factor
            for key in ['aperture_mm','width_mm','focal_mm','pitch_mm']:
                if key not in e or (source_mode=='fixed' and e['kind']=='source'):continue
                e[key]*=factor
    p['selected_components']={};p['name']=(str(p['name'])[:90]+f' · {factor:g}倍草案')
    p['notes']=(p.get('notes','')+f'\nGeometry scaling draft x{factor:g}, source={source_mode}. Component references cleared; power/timing unchanged. Validate with workbench before use.').strip()
    out.pop('calculation',None);out.pop('exported_at',None)
    out['scope']='Offline parameter/symbolic-scene draft; workbench import recalculates. No native optical validation.'
    return out

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('input',type=Path);p.add_argument('--factor',type=float,required=True);p.add_argument('--source-mode',choices=['fixed','all'],default='fixed');p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    if a.output.exists() or a.input.resolve()==a.output.resolve():p.error('Use a new output path')
    result=scale(json.loads(a.input.read_text('utf-8-sig')),a.factor,a.source_mode)
    a.output.write_text(json.dumps(result,ensure_ascii=False,allow_nan=False,indent=2)+'\n',encoding='utf8')
