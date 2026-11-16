"""Continuous closed 2.5D mesh with the unmodified approved artwork projected onto it.
Not a reconstructed free-view PBR character: the design is a fixed-camera desktop companion.
"""
import bpy,bmesh,math,json
import numpy as np
from pathlib import Path
from collections import Counter
from mathutils import Vector
from mathutils.geometry import delaunay_2d_cdt
R=Path(__file__).resolve().parent
if not bpy.app.background:raise RuntimeError('Dedicated background Blender required')
bpy.ops.wm.read_factory_settings(use_empty=True);bpy.context.preferences.filepaths.save_version=0
s=bpy.context.scene;s.name='Huibud · approved artwork / continuous 2.5D rig'
s.render.engine='CYCLES';s.cycles.device='CPU';s.cycles.samples=8;s.cycles.use_denoising=False
s.render.threads_mode='FIXED';s.render.threads=4;s.render.film_transparent=True
s.render.resolution_x=320;s.render.resolution_y=320;s.render.resolution_percentage=100
s.render.image_settings.file_format='PNG';s.render.image_settings.color_mode='RGBA';s.render.fps=24
s.view_settings.view_transform='Standard';s.view_settings.look='None';s.view_settings.exposure=0;s.view_settings.gamma=1
# Clockwise measured contour in the unchanged B crop (source board offset 560,195).
control=np.array([(251,15),(264,16),(276,24),(283,35),(287,45),(286,52),(283,56),(279,55),(276,50),(271,47),(266,49),(263,55),(261,64),(261,75),(268,89),
 (287,105),(309,131),(328,162),(340,192),(347,221),(345,248),(338,273),(326,294),(313,313),
 (315,329),(326,339),(334,353),(339,369),(339,379),(335,386),(330,388),(325,387),(319,387),(317,392),
 (313,404),(304,423),(291,436),(297,440),(302,447),(303,451),(299,455),(285,458),(267,459),(247,458),(229,455),(217,451),
 (217,457),(210,461),(193,464),(164,464),(141,462),(129,459),(125,455),(124,449),(122,445),(116,442),(107,438),(93,423),(86,407),(84,391),(85,374),(91,353),(100,334),(109,315),
 (95,309),(75,297),(57,281),(43,260),(35,237),(34,211),(39,184),(50,159),(67,138),(89,116),(115,97),(142,81),(172,64),(198,50),(216,35),(231,23)],dtype=float)
outline=[]
for i in range(len(control)):
 p0,p1,p2,p3=[control[j%len(control)] for j in (i-1,i,i+1,i+2)]
 for t in np.linspace(0,1,8,endpoint=False):outline.append(.5*((2*p1)+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t*t+(-p0+3*p1-3*p2+p3)*t*t*t))
outline=np.array(outline)
xs=np.arange(20,365,2.);ys=np.arange(5,475,2.);xx,yy=np.meshgrid(xs,ys);points=np.stack([xx.ravel(),yy.ravel()],axis=1)
inside=np.zeros(len(points),dtype=bool)
for a,b in zip(outline,np.roll(outline,-1,axis=0)):
 crossing=((a[1]>points[:,1])!=(b[1]>points[:,1]))&(points[:,0]<(b[0]-a[0])*(points[:,1]-a[1])/(b[1]-a[1]+1e-20)+a[0]);inside^=crossing
input_points=np.concatenate([outline,points[inside]])
triangulated=delaunay_2d_cdt([Vector(v) for v in input_points],[],[list(range(len(outline)))],1,.0001,False)
p=np.array([tuple(v) for v in triangulated[0]]);front=[tuple(f) for f in triangulated[2]]
edge_count=Counter(tuple(sorted((q[i],q[(i+1)%len(q)]))) for q in front for i in range(len(q)))
boundary=[e for e,c in edge_count.items() if c==1];boundary_ids=sorted({v for edge in boundary for v in edge})
distance=np.full(len(p),1e20);nearest=p.copy()
for a,b in zip(outline,np.roll(outline,-1,axis=0)):
 v=b-a;t=np.clip(((p-a)@v)/max(float(v@v),1e-12),0,1);proj=a+t[:,None]*v;d=((proj-p)**2).sum(axis=1);sel=d<distance
 distance[sel]=d[sel];nearest[sel]=proj[sel]
distance[boundary_ids]=0
depth=.012+.34*np.sqrt(np.clip(np.sqrt(distance)/95,0,1));n=len(p)
def position(x,y,d):return ((x-195)*.005,d,(470-y)*.005)
verts=[position(x,y,-d) for (x,y),d in zip(p,depth)]+[position(x,y,d*.65) for (x,y),d in zip(p,depth)]
faces=list(front)+[tuple(i+n for i in reversed(q)) for q in front]+[(a,b,b+n,a+n) for a,b in boundary]
mesh=bpy.data.meshes.new('Huibud one continuous closed surface');mesh.from_pydata(verts,[],faces);mesh.update()
obj=bpy.data.objects.new('Huibud body',mesh);s.collection.objects.link(obj)
bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(mesh);bm.free()
for face in mesh.polygons:face.use_smooth=True
uv=mesh.uv_layers.new(name='Approved artwork projection')
for loop in mesh.loops:
 x,y=p[loop.vertex_index%n];uv.data[loop.index].uv=((560+x)/1536,1-(195+y)/1024)
source=R/'reference-original.png'
if not source.exists():source=R.parent/'echo-character-design-20261107'/'echo-companion-alternatives.png'
image=bpy.data.images.load(str(source));image.pack();image.colorspace_settings.name='sRGB'
mat=bpy.data.materials.new('Original B artwork · baked illustration');mat.use_nodes=True;nodes=mat.node_tree.nodes;nodes.clear()
tex=nodes.new('ShaderNodeTexImage');tex.image=image;tex.interpolation='Linear';emission=nodes.new('ShaderNodeEmission');output=nodes.new('ShaderNodeOutputMaterial')
mat.node_tree.links.new(tex.outputs['Color'],emission.inputs['Color']);mat.node_tree.links.new(emission.outputs[0],output.inputs['Surface']);mesh.materials.append(mat)
back=bpy.data.materials.new('Unreconstructed back · plain ivory');back.use_nodes=True;bp=back.node_tree.nodes.get('Principled BSDF');bp.inputs['Base Color'].default_value=(.91,.80,.70,1);bp.inputs['Roughness'].default_value=.65;mesh.materials.append(back)
# Frontal faces preserve the source pixels. Back/sides are deliberately not claimed reconstructed.
for face in mesh.polygons:
 if all(v>=n for v in face.vertices) or (any(v>=n for v in face.vertices) and any(v<n for v in face.vertices)):face.material_index=1
obj.shape_key_add(name='Basis')
for name in ['Blink','Squash','Stretch']:
 key=obj.shape_key_add(name=name,from_mix=False)
 for v,b in zip(key.data,obj.data.shape_keys.key_blocks['Basis'].data):
  if name=='Squash':v.co=(b.co.x*1.035,b.co.y,.04+(b.co.z-.04)*.94)
  elif name=='Stretch':v.co=(b.co.x*.97,b.co.y,.04+(b.co.z-.04)*1.06)
  else:
   x=195+b.co.x/.005;y=470-b.co.z/.005
   for ex,ey in [(167,225),(294,190)]:
    radius=((x-ex)/25)**2+((y-ey)/29)**2
    weight=max(0,1-radius)**1.3
    v.co.z+=((470-ey)*.005-b.co.z)*.90*weight
arm=bpy.data.armatures.new('Huibud image-preserving rig');rig=bpy.data.objects.new('Echo Huibud · Rig',arm);s.collection.objects.link(rig)
bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
def coord(x,y):return ((x-195)*.005,0,(470-y)*.005)
def bone(name,a,b,parent=None):
 x=arm.edit_bones.new(name);x.head=coord(*a);x.tail=coord(*b)
 if parent:x.parent=arm.edit_bones[parent]
bone('root',(195,470),(195,450));bone('body',(205,447),(215,322),'root');bone('head',(215,322),(235,140),'body');bone('tip',(255,78),(267,28),'head')
bone('hand.L',(170,331),(130,385),'body');bone('hand.R',(316,329),(332,375),'body');bone('foot.L',(169,439),(169,458),'root');bone('foot.R',(264,439),(264,458),'root')
bpy.ops.object.mode_set(mode='OBJECT');rig.show_in_front=True
groups={name:obj.vertex_groups.new(name=name) for name in ['body','head','tip','hand.L','hand.R','foot.L','foot.R']}
def smoothstep(a,b,v):
 t=max(0,min(1,(v-a)/(b-a)));return t*t*(3-2*t)
for i,(x,y) in enumerate(p):
 h=1-smoothstep(275,337,y);tip=(1-smoothstep(65,108,y))*smoothstep(205,240,x)
 l=max(0,1-((x-145)/48)**2-((y-362)/57)**2)**.7*.93
 rr=max(0,1-((x-331)/27)**2-((y-356)/44)**2)**.7*.93
 foot=smoothstep(427,449,y);fl=foot*(1-smoothstep(208,236,x));fr=foot*smoothstep(208,236,x)
 remaining=max(0,1-l-rr-fl-fr);weights={'body':remaining*(1-h),'head':remaining*h*(1-tip),'tip':remaining*h*tip,'hand.L':l,'hand.R':rr,'foot.L':fl,'foot.R':fr}
 total=sum(weights.values())
 for name,value in weights.items():
  if value>0:groups[name].add([i,i+n],value/total,'REPLACE')
mod=obj.modifiers.new('Continuous skin deformation','ARMATURE');mod.object=rig;mod.use_deform_preserve_volume=True;obj.parent=rig
for prop,key in [('blink','Blink'),('squash','Squash'),('stretch','Stretch')]:
 rig[prop]=0.;rig.id_properties_ui(prop).update(min=0.,max=1.);driver=obj.data.shape_keys.key_blocks[key].driver_add('value').driver;driver.type='AVERAGE';v=driver.variables.new();v.name=prop;v.type='SINGLE_PROP';v.targets[0].id=rig;v.targets[0].data_path='["'+prop+'"]'
for b in rig.pose.bones:b.rotation_mode='XYZ'
clips={'idle':96,'greet':48,'drag':48,'land':24,'work':72,'wait':72,'success':48};rig.animation_data_create()
def bell(t,c,w):return max(0,1-abs(t-c)/w)**2
for clip,count in clips.items():
 action=bpy.data.actions.new('Echo_'+clip);action.use_fake_user=True;rig.animation_data.action=action
 for f in range(count):
  t=f/(count-1);a=math.tau*t
  for b in rig.pose.bones:b.rotation_euler=(0,0,0);b.location=(0,0,0);b.scale=(1,1,1)
  root=rig.pose.bones['root'];body=rig.pose.bones['body'];head=rig.pose.bones['head'];hand=rig.pose.bones['hand.L']
  rig['blink']=max(bell(t,.37,.035),bell(t,.83,.03));rig['squash']=0.;rig['stretch']=0.
  body.scale=(1+.003*math.sin(a),1+.005*math.sin(a),1)
  if clip=='idle':head.rotation_euler.z=.008*math.sin(a)
  if clip=='greet':
   env=math.sin(math.pi*t);hand.rotation_euler.z=.30*env+.06*math.sin(5*math.pi*t)*env;head.rotation_euler.z=.025*env
  if clip=='drag':rig['stretch']=.65;hand.rotation_euler.z=.08+.04*math.sin(a);rig.pose.bones['tip'].rotation_euler.z=.035*math.sin(a)
  if clip=='land':rig['squash']=.8*bell(t,.2,.2)+.15*bell(t,.65,.18);rig['stretch']=.2*bell(t,.43,.18)
  if clip=='work':head.rotation_euler.z=.015*math.sin(a);hand.rotation_euler.z=-.045*math.sin(a)**2
  if clip=='wait':head.rotation_euler.z=.035*math.sin(math.pi*t)**2;hand.rotation_euler.z=.12*math.sin(math.pi*t)**2
  if clip=='success':root.location.y=.15*math.sin(math.pi*t)**2;hand.rotation_euler.z=.34*math.sin(math.pi*t);rig['squash']=.5*bell(t,.12,.12)+.5*bell(t,.85,.13);rig['blink']=bell(t,.87,.04)
  for b in rig.pose.bones:
   for field in ['location','rotation_euler','scale']:b.keyframe_insert(data_path=field,frame=f+1,group=b.name)
  for prop in ['blink','squash','stretch']:rig.keyframe_insert(data_path='["'+prop+'"]',frame=f+1,group='Expressions')
 action['clip']=clip;action['loop']=clip in ['idle','drag','work','wait'];action['fps']=24
rig.animation_data.action=bpy.data.actions['Echo_idle'];s.frame_set(1);s.frame_start=1;s.frame_end=96
bpy.ops.object.camera_add(location=(0,-6,1.225));camera=bpy.context.object;camera.rotation_euler=(Vector((0,0,1.225))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=2.75;s.camera=camera
s['asset']='回芽 · 原画投影 2.5D';s['rig_object']=rig.name;s['animation_manifest']=json.dumps(clips);s['fixed_camera']=True;s['unreconstructed_back']=True
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);bpy.context.view_layer.objects.active=rig
bpy.ops.wm.save_as_mainfile(filepath=str(R/'Echo-Huibud-Illustrated.blend'))
s.render.resolution_x=640;s.render.resolution_y=640;s.cycles.samples=16;s.render.filepath=str(R/'faithful-lookdev.png');bpy.ops.render.render(write_still=True)
edge_counts=Counter(tuple(sorted((face.vertices[i],face.vertices[(i+1)%len(face.vertices)]))) for face in mesh.polygons for i in range(len(face.vertices)))
assert all(c==2 for c in edge_counts.values()),'Surface must be closed and continuous'
neighbors=[[] for _ in mesh.vertices]
for edge in mesh.edges:
 a,b=edge.vertices;neighbors[a].append(b);neighbors[b].append(a)
visited=set();queue=[0]
while queue:
 v=queue.pop()
 if v in visited:continue
 visited.add(v);queue.extend(i for i in neighbors[v] if i not in visited)
assert len(visited)==len(mesh.vertices),'All limbs must belong to one connected component'
result={'source':'Echo-Huibud-Illustrated.blend','technique':'fixed-camera 2.5D with original artwork projection','bones':[b.name for b in arm.bones],'actions':clips,'vertices':len(mesh.vertices),'faces':len(mesh.polygons),'watertight':True,'connected_components':1,'separate_limb_meshes':0,'reference_packed':bool(image.packed_file),'free_view_back_reconstructed':False,'referenceCrop':[560,195,955,685]}
(R/'faithful-model-evidence.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
