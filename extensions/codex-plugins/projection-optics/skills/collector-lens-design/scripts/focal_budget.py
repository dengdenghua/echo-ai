"""Air-to-air centered paraxial focal checks; JSON in/out, no simulator dependency."""
import argparse
import json
import math
from pathlib import Path
import sys


def finite(x, name):
    if isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x):
        raise ValueError(name + ': expected a finite number')
    return float(x)


def keys(d, allowed, required):
    if not isinstance(d, dict):
        raise ValueError('Expected a JSON object')
    extra = set(d) - set(allowed)
    missing = set(required) - set(d)
    if extra or missing:
        raise ValueError('Unknown keys: '+str(sorted(extra))+'; missing: '+str(sorted(missing)))


def calculate(d):
    if not isinstance(d, dict):
        raise ValueError('Expected a JSON object')
    mode = d.get('mode')
    warnings = ['Analytical/finite-probe estimate, not a measured or validated finite-NA lens result.']
    if mode == 'parallel-rays':
        keys(d, ['mode', 'rays'], ['mode', 'rays'])
        if not isinstance(d['rays'], list) or len(d['rays']) != 2:
            raise ValueError('Provide exactly two distinct-height parallel input probes')
        values = []
        for r in d['rays']:
            keys(r, ['height_mm', 'output_angle_deg'], ['height_mm', 'output_angle_deg'])
            h = finite(r['height_mm'], 'height_mm')
            deg = finite(r['output_angle_deg'], 'output_angle_deg')
            if abs(deg) >= 90:
                raise ValueError('output_angle_deg must be inside (-90, 90)')
            values.append((h, math.radians(deg)))
        dh = values[1][0] - values[0][0]
        if abs(dh) < 1e-15:
            raise ValueError('Different probe heights required; axial or repeated height is insufficient')
        c = (values[1][1] - values[0][1]) / dh
        if abs(c) < 1e-15:
            raise ValueError('No finite focal estimate: angular slope is zero')
        if max(abs(u) for _, u in values) > math.radians(2):
            warnings.append('Large output angle: finite-height mapping is not verified paraxial EFL.')
        warnings.append('Two parallel probes determine C only; no front focus or principal plane can be inferred.')
        return {'mode': mode, 'C_per_mm': c, 'focal_estimate_mm': -1/c, 'warnings': warnings,
                'assumptions': 'Parallel incident probes; centered system; air on both sides; signed output angles about the same axis.'}
    if mode != 'matrix':
        raise ValueError('mode must be matrix or parallel-rays')
    keys(d, ['mode','matrix','z_in_mm','z_out_mm','source_width_mm','source_height_mm','source_z_mm'], ['mode','matrix','z_in_mm','z_out_mm'])
    m = d['matrix']
    if not isinstance(m, list) or len(m)!=2 or any(not isinstance(row,list) or len(row)!=2 for row in m):
        raise ValueError('matrix must be 2x2')
    a,b,c,e = [finite(x,'matrix') for row in m for x in row]
    det=a*e-b*c
    if not math.isclose(det, 1, rel_tol=0, abs_tol=1e-4):
        raise ValueError('Matrix determinant must be near 1 for this air-to-air y/theta convention')
    if abs(c)<1e-15:
        raise ValueError('Afocal matrix: no finite EFL')
    zi=finite(d['z_in_mm'],'z_in_mm');zo=finite(d['z_out_mm'],'z_out_mm')
    if zo<zi:
        raise ValueError('Reference planes must follow increasing +Z propagation')
    f=-1/c;front=zi+e/c;rear=zo-a/c
    result={'mode':mode,'efl_mm':f,'front_focal_z_mm':front,'rear_focal_z_mm':rear,
            'front_principal_z_mm':front+f,'rear_principal_z_mm':rear-f,'determinant':det,
            'assumptions':'Centered first-order system, air on both sides, state [height_mm, angle_rad], +Z propagation.',
            'warnings':warnings}
    if 'source_z_mm' in d:
        dz=finite(d['source_z_mm'],'source_z_mm')-front
        result['source_minus_front_focus_mm']=dz
        if abs(dz)>1e-9:
            warnings.append('Source is displaced from the paraxial front focus; angle budget below assumes refocusing, not actual defocused performance.')
    dims=['source_width_mm','source_height_mm']
    if any(k in d for k in dims):
        if not all(k in d for k in dims):raise ValueError('Both source dimensions are required')
        if f<=0:raise ValueError('Collimation source budget requires positive EFL')
        w,h=[finite(d[k],k) for k in dims]
        if min(w,h)<=0:raise ValueError('Source dimensions must be positive')
        result['ideal_at_focus_half_angles_deg']=[math.degrees(math.atan(x/(2*f))) for x in [w,h]]
        warnings.append('Thin-lens atan half-angle estimate; finite-NA aberration and true source distribution require ray validation.')
    return result


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--input',required=True,help='JSON path, or - for stdin');args=p.parse_args()
    try:
        raw=sys.stdin.read() if args.input=='-' else Path(args.input).read_text(encoding='utf-8-sig')
        result=calculate(json.loads(raw));print(json.dumps(result,ensure_ascii=False,indent=2,allow_nan=False))
    except (ValueError, OSError, TypeError) as exc:
        print(json.dumps({'error':str(exc)},ensure_ascii=False),file=sys.stderr);return 2
    return 0


if __name__=='__main__':
    raise SystemExit(main())
