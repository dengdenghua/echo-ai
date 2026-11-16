import bpy, math, json, os
from mathutils import Vector
from pathlib import Path

OUT=Path(__file__).resolve().parent
if not bpy.app.background: raise RuntimeError('Use a dedicated background Blender process.')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.preferences.filepaths.save_version=0
scene=bpy.context.scene;scene.name='Echo Huibud · B selected concept'
scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=24
scene.cycles.use_denoising=True;scene.cycles.seed=17
scene.render.threads_mode='FIXED';scene.render.threads=4
scene.render.resolution_x=320;scene.render.resolution_y=320;scene.render.resolution_percentage=100
scene.render.film_transparent=True;scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA';scene.render.fps=24
scene.view_settings.view_transform='AgX';scene.view_settings.exposure=.65
scene.world=bpy.data.worlds.new('Warm pearl studio');scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.90,.86,.79,1)
scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.32

def material(name,color,rough):
 m=bpy.data.materials.new(name);m.use_nodes=True
 p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=rough
 return m,p
pearl,p=material('Huibud · warm ivory satin',(.94,.86,.76),.31)
p.inputs['Subsurface Weight'].default_value=.12;p.inputs['Subsurface Radius'].default_value=(.22,.15,.10)
p.inputs['Coat Weight'].default_value=.23;p.inputs['Coat Roughness'].default_value=.27
mint,mp=material('Huibud · seafoam curl',(.38,.61,.49),.29)
mp.inputs['Subsurface Weight'].default_value=.10;mp.inputs['Coat Weight'].default_value=.24
bodymat=pearl.copy();bodymat.name='Huibud · seamless mint under-curl'
nodes=bodymat.node_tree.nodes;links=bodymat.node_tree.links
attr=nodes.new('ShaderNodeVertexColor');attr.layer_name='MintMask'
mix=nodes.new('ShaderNodeMixRGB');mix.inputs[1].default_value=(.94,.86,.76,1);mix.inputs[2].default_value=(.50,.73,.64,1)
links.new(attr.outputs['Color'],mix.inputs[0]);links.new(mix.outputs[0],nodes.get('Principled BSDF').inputs['Base Color'])
eye,ep=material('Huibud · obsidian eyes',(.012,.009,.009),.16);ep.inputs['Coat Weight'].default_value=.35;ep.inputs['Coat Roughness'].default_value=.15
mouthmat,_=material('Huibud · quiet smile',(.065,.038,.028),.43)

def smooth(obj):
 for f in obj.data.polygons:f.use_smooth=True
def ellipsoid(name,loc,scale,mat):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=32,ring_count=20,location=loc)
 obj=bpy.context.object;obj.name=name;obj.scale=scale;bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
 obj.data.materials.append(mat);smooth(obj);return obj

# One continuous torso/head/curl surface; compact body, generous cheeks, small crown curl.
# z, radius-x, center-x, depth ratio
rings=[(.17,.025,0,.80),(.20,.28,0,.80),(.29,.43,0,.78),(.45,.51,0,.76),(.64,.50,0,.76),(.82,.43,0,.76),(.97,.32,0,.80),
 (1.07,.35,-.02,.80),(1.16,.57,-.04,.74),(1.33,.76,-.04,.71),(1.53,.85,-.02,.69),(1.73,.84,0,.69),(1.92,.75,.035,.70),(2.08,.59,.075,.72),
 (2.19,.39,.14,.76),(2.25,.25,.22,.80),(2.33,.15,.32,.83),(2.40,.11,.44,.86),(2.41,.085,.55,.87),(2.36,.05,.62,.90),(2.32,.008,.63,.95)]
n=64;verts=[];faces=[];masks=[]
for j,(z,r,cx,depth) in enumerate(rings):
 if j<15:normal=Vector((1,0,0))
 else:
  prev=rings[j-1];nxt=rings[min(j+1,len(rings)-1)]
  tangent=Vector((nxt[2]-prev[2],0,nxt[0]-prev[0])).normalized();normal=Vector((tangent.z,0,-tangent.x))
 for i in range(n):
  a=i*math.tau/n;v=Vector((cx,0,z))+normal*(r*math.cos(a))+Vector((0,r*depth*math.sin(a),0));verts.append(tuple(v))
  masks.append(max(0,min(1,(j-15)/2))*max(0,min(1,.55+math.cos(a)*.65)))
for j in range(len(rings)-1):
 for i in range(n):
  a=j*n+i;b=j*n+(i+1)%n;faces.append((a,b,b+n,a+n))
faces.extend([tuple(reversed(range(n))),tuple((len(rings)-1)*n+i for i in range(n))])
mesh=bpy.data.meshes.new('Huibud continuous silhouette');mesh.from_pydata(verts,[],faces);mesh.update()
body=bpy.data.objects.new('Huibud body',mesh);scene.collection.objects.link(body);body.data.materials.append(bodymat);smooth(body)
body.data.materials.append(mint)
for face in mesh.polygons:
 j=face.index//n;i=face.index%n
 if 16<=j<len(rings)-1 and math.cos((i+.5)*math.tau/n)>-.30:face.material_index=1
colors=mesh.color_attributes.new(name='MintMask',type='FLOAT_COLOR',domain='CORNER')
for item,loop in zip(colors.data,mesh.loops):
 v=masks[loop.vertex_index];item.color=(v,v,v,1)
sub=body.modifiers.new('Soft silhouette','SUBSURF');sub.levels=2;sub.render_levels=2
body.shape_key_add(name='Basis')
for name,sx,sz in [('Squash',1.06,.93),('Stretch',.95,1.07)]:
 key=body.shape_key_add(name=name,from_mix=False)
 for v,b in zip(key.data,body.data.shape_keys.key_blocks['Basis'].data):v.co=(b.co.x*sx,b.co.y*sx,.17+(b.co.z-.17)*sz)
def surface(x,z):
 for j in range(14):
  a,b=rings[j],rings[j+1]
  if a[0]<=z<=b[0]:
   t=(z-a[0])/(b[0]-a[0]);r=a[1]+(b[1]-a[1])*t;cx=a[2]+(b[2]-a[2])*t;depth=a[3]+(b[3]-a[3])*t
   return -r*depth*math.sqrt(max(.05,1-((x-cx)/r)**2))+.012
 return -.5
eyes=[]
for x in [-.235,.235]:
 o=ellipsoid('Eye '+('L' if x<0 else 'R'),(x,0,1.58),(.062,.032,.091),eye)
 for v in o.data.vertices:v.co.y+=surface(v.co.x,v.co.z)-.012
 o.shape_key_add(name='Basis');key=o.shape_key_add(name='Blink')
 for v in key.data:v.co.z=1.58+(v.co.z-1.58)*.08
 eyes.append(o)
curve=bpy.data.curves.new('Huibud smile curve','CURVE');curve.dimensions='3D';curve.resolution_u=16;curve.bevel_depth=.011;curve.bevel_resolution=3
spline=curve.splines.new('POLY');spline.points.add(24)
for i,point in enumerate(spline.points):
 x=-.105+i*.21/24;z=1.405+.04*(x/.105)**2;point.co=(x,surface(x,z)-.011,z,1)
mouth=bpy.data.objects.new('Huibud smile',curve);scene.collection.objects.link(mouth);mouth.data.materials.append(mouthmat)
bpy.ops.object.select_all(action='DESELECT');bpy.context.view_layer.objects.active=mouth;mouth.select_set(True);bpy.ops.object.convert(target='MESH');mouth=bpy.context.object
hands=[];feet=[]
for s,label in [(-1,'L'),(1,'R')]:
 o=ellipsoid('Hand '+label,(s*.445,-.20,.70),(.145,.145,.25),pearl)
 for v in o.data.vertices:v.co.x-=s*.30*(v.co.z-.70)
 hands.append(o);feet.append(ellipsoid('Foot '+label,(s*.235,-.13,.135),(.225,.29,.115),pearl))

arm=bpy.data.armatures.new('Huibud deform rig');rig=bpy.data.objects.new('Echo Huibud · Rig',arm);scene.collection.objects.link(rig)
bpy.ops.object.select_all(action='DESELECT');bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
def bone(name,head,tail,parent=None):
 b=arm.edit_bones.new(name);b.head=head;b.tail=tail
 if parent:b.parent=arm.edit_bones[parent]
 return b
bone('root',(0,0,0),(0,0,.17));bone('body',(0,0,.17),(0,0,1.04),'root');bone('head',(0,0,1.04),(0,0,2.1),'body');bone('tip',(.20,0,2.16),(.58,0,2.43),'head')
for s,label in [(-1,'L'),(1,'R')]:
 bone('hand.'+label,(s*.39,-.10,.89),(s*.48,-.20,.48),'body');bone('foot.'+label,(s*.235,0,.15),(s*.235,-.23,.13),'root')
bpy.ops.object.mode_set(mode='OBJECT');rig.show_in_front=True
def weight(obj,name):
 group=obj.vertex_groups.new(name=name);group.add(list(range(len(obj.data.vertices))),1,'REPLACE')
 mod=obj.modifiers.new('Huibud rig','ARMATURE');mod.object=rig;obj.parent=rig
weight(body,'body');hg=body.vertex_groups.new(name='head');tg=body.vertex_groups.new(name='tip')
for v in body.data.vertices:
 h=max(0,min(1,(v.co.z-.90)/.34));tip=max(0,min(1,(v.co.z-2.18)/.18))*.8
 hg.add([v.index],h*(1-tip),'REPLACE');tg.add([v.index],tip,'REPLACE');body.vertex_groups['body'].add([v.index],1-h,'REPLACE')
for o in eyes+[mouth]:weight(o,'head')
for i,label in enumerate(['L','R']):weight(hands[i],'hand.'+label);weight(feet[i],'foot.'+label)
for prop in ['blink','squash','stretch']:rig[prop]=0.;rig.id_properties_ui(prop).update(min=0.,max=1.)
for obj,key,prop in [(body,'Squash','squash'),(body,'Stretch','stretch')]+[(o,'Blink','blink') for o in eyes]:
 d=obj.data.shape_keys.key_blocks[key].driver_add('value').driver;d.type='AVERAGE';v=d.variables.new();v.name=prop;v.type='SINGLE_PROP';v.targets[0].id=rig;v.targets[0].data_path='["'+prop+'"]'
for pb in rig.pose.bones:pb.rotation_mode='XYZ'

clips={'idle':96,'greet':48,'drag':48,'land':24,'work':72,'wait':72,'success':48};rig.animation_data_create()
def bell(t,c,w):return max(0,1-abs(t-c)/w)**2
for clip,count in clips.items():
 action=bpy.data.actions.new('Echo_'+clip);action.use_fake_user=True;rig.animation_data.action=action
 for f in range(count):
  t=f/(count-1);a=math.tau*t
  for pb in rig.pose.bones:pb.location=(0,0,0);pb.rotation_euler=(0,0,0);pb.scale=(1,1,1)
  root=rig.pose.bones['root'];bod=rig.pose.bones['body'];head=rig.pose.bones['head'];tip=rig.pose.bones['tip'];wave=rig.pose.bones['hand.L'];hand=rig.pose.bones['hand.R']
  rig['blink']=max(bell(t,.37,.035),bell(t,.83,.03));rig['squash']=0.;rig['stretch']=0.
  bod.scale=(1+.006*math.sin(a),1+.006*math.sin(a),1+.01*math.sin(a));head.rotation_euler.z=.055+.02*math.sin(a);tip.rotation_euler.y=.035*math.sin(a)
  if clip=='idle':bod.rotation_euler.z=.012*math.sin(a)
  if clip=='greet':
   env=math.sin(math.pi*t)**.7;head.rotation_euler.z+=.07*env;wave.rotation_euler.z=2.1*env;wave.rotation_euler.x=.27*math.sin(5*math.pi*t)*env
   wave.location=wave.bone.matrix_local.to_3x3().inverted()@Vector((-.16,-.09,.06))*env;rig['blink']=bell(t,.14,.04)
  if clip=='drag':
   rig['stretch']=.65;head.rotation_euler.z+=.045*math.sin(a);tip.rotation_euler.y=.11*math.sin(a);wave.rotation_euler.z=.32;hand.rotation_euler.z=-.32
   for side in ['L','R']:rig.pose.bones['foot.'+side].rotation_euler.x=.10*math.sin(a)
  if clip=='land':
   rig['squash']=.8*bell(t,.2,.2)+.18*bell(t,.65,.18);rig['stretch']=.23*bell(t,.43,.18);rig['blink']=.45*bell(t,.2,.15);root.location.y=.05*max(0,math.sin(2*math.pi*t))*math.sin(math.pi*t)
  if clip=='work':
   head.rotation_euler.x=.07*math.sin(a)**2;head.rotation_euler.z+=.025*math.sin(a)
   for side,s in [('L',1),('R',-1)]:
    pb=rig.pose.bones['hand.'+side];pb.rotation_euler.x=.20*math.sin(a)**2;pb.rotation_euler.z=-s*.16*math.sin(a)**2
  if clip=='wait':
   env=math.sin(math.pi*t)**2;head.rotation_euler.z+=.13*env;wave.rotation_euler.z=1.95*env;wave.rotation_euler.x=.09*math.sin(a)*env
   wave.location=wave.bone.matrix_local.to_3x3().inverted()@Vector((-.12,-.12,.03))*env
  if clip=='success':
   env=math.sin(math.pi*t);root.location.y=.20*env**2;rig['squash']=.5*bell(t,.12,.12)+.55*bell(t,.85,.13);rig['stretch']=.35*bell(t,.4,.2)
   wave.rotation_euler.z=2.1*env;wave.rotation_euler.x=.28*math.sin(5*math.pi*t)*env;wave.location=wave.bone.matrix_local.to_3x3().inverted()@Vector((-.16,-.09,.06))*env;head.rotation_euler.z+=.06*math.sin(a);rig['blink']=bell(t,.87,.04)
  for pb in rig.pose.bones:
   for field in ['location','rotation_euler','scale']:pb.keyframe_insert(data_path=field,frame=f+1,group=pb.name)
  for prop in ['blink','squash','stretch']:rig.keyframe_insert(data_path='["'+prop+'"]',frame=f+1,group='Expressions')
 action['clip']=clip;action['loop']=clip in ['idle','drag','work','wait'];action['fps']=24

def aim(o,p):o.rotation_euler=(Vector(p)-o.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(-1.3,-9,2.8));cam=bpy.context.object;cam.name='Huibud portrait camera';cam.data.type='ORTHO';cam.data.ortho_scale=3.15;aim(cam,(0,0,1.28));scene.camera=cam
for name,loc,power,size,color in [('Warm key',(-3.4,-4.5,5),450,3.3,(1,.91,.82)),('Soft fill',(3,-4,2.7),210,3.5,(.87,.94,1)),('Pearl rim',(-2,2,3.4),290,2.8,(.80,1,.94)),('Eye glint',(-1.4,-4,4.5),50,.7,(1,.98,.95))]:
 bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.name=name;o.data.energy=power;o.data.shape='DISK';o.data.size=size;o.data.color=color;aim(o,(0,0,1.3))
rig.animation_data.action=bpy.data.actions['Echo_idle'];scene.frame_start=1;scene.frame_end=96;scene.frame_set(1)
scene['asset']='Echo Huibud / 回芽';scene['rig_object']=rig.name;scene['animation_manifest']=json.dumps(clips);scene['notes']='User-selected B concept. Native task-driven atlas playback; 8 bones incl. independent head.'
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);bpy.context.view_layer.objects.active=rig
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'Echo-Huibud.blend'))
scene.render.resolution_x=640;scene.render.resolution_y=640;scene.cycles.samples=64
scene.render.filepath=str(OUT/'lookdev.png');bpy.ops.render.render(write_still=True)
(OUT/'model-evidence.json').write_text(json.dumps({'bones':[b.name for b in arm.bones],'actions':clips,'shapeKeys':['Blink','Squash','Stretch'],'resolution':320,'fps':24,'source':'Echo-Huibud.blend','character':'回芽','reference':'selected B'},ensure_ascii=False,indent=2),encoding='utf8')
