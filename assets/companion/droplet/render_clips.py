import bpy,json,time,sys
from pathlib import Path
OUT=Path(__file__).resolve().parent
scene=bpy.context.scene;rig=bpy.data.objects['Echo Droplet · Rig']
clips=json.loads(scene['animation_manifest'])
scene.render.resolution_x=320;scene.render.resolution_y=320;scene.cycles.samples=24
scene.cycles.seed=17;scene.cycles.use_animated_seed=False
scene.render.threads_mode='FIXED';scene.render.threads=4
scene.render.use_persistent_data=True
args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
force='--force' in args
args=[a for a in args if a!='--force']
for clip,count in clips.items():
 if args and clip not in args:continue
 rig.animation_data.action=bpy.data.actions['Echo_'+clip]
 folder=OUT/'frames'/clip;folder.mkdir(parents=True,exist_ok=True)
 for f in range(count):
  path=folder/f'{f:03d}.png'
  if path.exists() and not force:continue
  scene.frame_set(f+1);scene.render.filepath=str(path);bpy.ops.render.render(write_still=True)
  (OUT/'render-progress.json').write_text(json.dumps({'clip':clip,'frame':f+1,'frames':count,'updated':time.time()}),encoding='utf8')
print('ECHO_RENDER_COMPLETE',list(clips))
