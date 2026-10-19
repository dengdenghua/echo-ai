import importlib.util
import math
from pathlib import Path
import unittest

path=Path(__file__).resolve().parents[1]/'skills/collector-lens-design/scripts/focal_budget.py'
spec=importlib.util.spec_from_file_location('focal',path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
calc=module.calculate

class FocalChecks(unittest.TestCase):
    def test_synthetic_thin_lens(self):
        r=calc(dict(mode='matrix',matrix=[[1,0],[-.1,1]],z_in_mm=0,z_out_mm=0,source_width_mm=2,source_height_mm=1,source_z_mm=-10))
        self.assertAlmostEqual(r['efl_mm'],10)
        self.assertAlmostEqual(r['front_focal_z_mm'],-10)
        self.assertAlmostEqual(r['rear_focal_z_mm'],10)
        self.assertAlmostEqual(r['front_principal_z_mm'],0)
        self.assertAlmostEqual(r['ideal_at_focus_half_angles_deg'][0],math.degrees(math.atan(.1)))

    def test_shifted_reference_planes_preserve_physical_cardinals(self):
        # Same f=10 lens at global z=2, input plane z=0, output z=22.
        r=calc(dict(mode='matrix',matrix=[[-1,18],[-.1,.8]],z_in_mm=0,z_out_mm=22,source_z_mm=-7))
        self.assertAlmostEqual(r['efl_mm'],10)
        self.assertAlmostEqual(r['front_focal_z_mm'],-8)
        self.assertAlmostEqual(r['rear_focal_z_mm'],12)
        self.assertAlmostEqual(r['front_principal_z_mm'],2)
        self.assertAlmostEqual(r['rear_principal_z_mm'],2)
        self.assertAlmostEqual(r['source_minus_front_focus_mm'],1)

    def test_parallel_probe_does_not_invent_focal_plane(self):
        r=calc(dict(mode='parallel-rays',rays=[dict(height_mm=-.001,output_angle_deg=math.degrees(.0001)),dict(height_mm=.001,output_angle_deg=-math.degrees(.0001))]))
        self.assertAlmostEqual(r['focal_estimate_mm'],10)
        self.assertNotIn('front_focal_z_mm',r)

    def test_invalid_or_degenerate_data(self):
        bad=[dict(mode='matrix',matrix=[[1,0],[0,1]],z_in_mm=0,z_out_mm=0),dict(mode='matrix',matrix=[[2,0],[-.1,1]],z_in_mm=0,z_out_mm=0),dict(mode='parallel-rays',rays=[dict(height_mm=0,output_angle_deg=0)]*2),dict(mode='matrix',matrix=[[1,0],[-.1,1]],z_in_mm=float('nan'),z_out_mm=0)]
        for data in bad:
            with self.subTest(data=data),self.assertRaises(ValueError):calc(data)

if __name__=='__main__':unittest.main()
