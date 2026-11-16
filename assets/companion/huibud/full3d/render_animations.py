import bpy,json,time,hashlib
from pathlib import Path
R=Path(__file__).parent;s=bpy.context.scene;rig=bpy.data.objects[s['rig_object']];clips=json.loads(s['animation_manifest'])
source_sha=hashlib.sha256((R/'Echo-Huibud-3D.blend').read_bytes()).hexdigest()
s.render.resolution_x=320;s.render.resolution_y=320;s.cycles.samples=24;s.cycles.seed=17;s.cycles.use_animated_seed=False
s.camera.data.ortho_scale=2.85 # Leave full head/feet margins throughout the hop.
s.render.threads_mode='FIXED';s.render.threads=4;s.render.use_persistent_data=True
for clip,count in clips.items():
 rig.animation_data.action=bpy.data.actions['Echo_'+clip];folder=R/'frames'/clip;folder.mkdir(parents=True,exist_ok=True)
 for f in range(count):
  s.frame_set(f+1);s.render.filepath=str(folder/f'{f:03d}.png');bpy.ops.render.render(write_still=True)
  (R/'render-progress.json').write_text(json.dumps({'clip':clip,'frame':f+1,'frames':count,'updated':time.time()}))
assert source_sha==hashlib.sha256((R/'Echo-Huibud-3D.blend').read_bytes()).hexdigest(),'Source changed during rendering'
(R/'render-complete.json').write_text(json.dumps({'ok':True,'sourceSha256':source_sha,'frames':sum(clips.values()),'clips':clips}))
print('FULL_3D_ANIMATIONS_COMPLETE')
