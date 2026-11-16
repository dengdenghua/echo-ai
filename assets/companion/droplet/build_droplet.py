import bpy, math, json, os
from mathutils import Vector
from pathlib import Path

OUT=Path(os.environ.get('ECHO_DROPLET_OUTPUT',str(Path(__file__).resolve().parent)))
OUT.mkdir(exist_ok=True,parents=True)
# This runs only in an isolated background Blender process.
if not bpy.app.background:raise RuntimeError('Run this asset builder in a dedicated background Blender process.')
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene
scene.name='Echo · Pearl Droplet'
scene.render.engine='CYCLES'
scene.cycles.device='CPU'
scene.cycles.samples=24
scene.cycles.use_denoising=True
scene.render.threads_mode='FIXED';scene.render.threads=4
scene.render.resolution_x=320;scene.render.resolution_y=320;scene.render.resolution_percentage=100
scene.render.film_transparent=True
scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
scene.render.fps=24
scene.view_settings.view_transform='AgX'
scene.world=bpy.data.worlds.new('Pearl studio')
scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.72,.83,.9,1)
scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.55

def mat(name,color,rough=.28):
 m=bpy.data.materials.new(name);m.use_nodes=True
 p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=rough
 return m,p
pearl,p=mat('Pearl milk · aqua rim',(.88,.96,.98),.22)
p.inputs['Coat Weight'].default_value=.5;p.inputs['Coat Roughness'].default_value=.21
p.inputs['Subsurface Weight'].default_value=.075;p.inputs['Subsurface Radius'].default_value=(.16,.28,.34)
p.inputs['Transmission Weight'].default_value=.07;p.inputs['IOR'].default_value=1.38
nodes=pearl.node_tree.nodes;links=pearl.node_tree.links
layer=nodes.new('ShaderNodeLayerWeight');layer.inputs['Blend'].default_value=.3
ramp=nodes.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].position=.05;ramp.color_ramp.elements[0].color=(.97,.96,.94,1)
ramp.color_ramp.elements[1].position=.45;ramp.color_ramp.elements[1].color=(.54,.84,.86,1)
links.new(layer.outputs['Fresnel'],ramp.inputs[0]);links.new(ramp.outputs[0],p.inputs['Base Color'])
eye,ep=mat('Ink eyes',(.009,.012,.017),.50);ep.inputs['Coat Weight'].default_value=.05;ep.inputs['Specular IOR Level'].default_value=.20

def smooth(obj):
 for poly in obj.data.polygons:poly.use_smooth=True
def ellipsoid(name,loc,scale,material):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=24,ring_count=16,location=loc)
 o=bpy.context.object;o.name=name;o.scale=scale
 bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
 o.data.materials.append(material);smooth(o);return o

# Rounded pear-shaped silhouette with a gently curved droplet tip.
rings=[(.30,.02,0),(.35,.38,0),(.43,.62,0),(.60,.80,0),(.82,.88,0),(1.04,.87,.015),(1.25,.79,.035),(1.46,.66,.07),(1.65,.55,.12),(1.82,.45,.18),(1.98,.36,.25),(2.12,.27,.32),(2.23,.18,.38),(2.31,.08,.40),(2.33,.008,.40)]
verts=[];faces=[];n=48
for z,r,cx in rings:
 for i in range(n):
  a=i*math.tau/n;verts.append((cx+r*math.cos(a),r*.73*math.sin(a),z))
for j in range(len(rings)-1):
 for i in range(n):
  a=j*n+i;b=j*n+(i+1)%n;faces.append((a,b,b+n,a+n))
faces.extend([tuple(reversed(range(n))),tuple((len(rings)-1)*n+i for i in range(n))])
mesh=bpy.data.meshes.new('Pearl silhouette');mesh.from_pydata(verts,[],faces);mesh.update()
body=bpy.data.objects.new('Droplet body',mesh);scene.collection.objects.link(body);body.data.materials.append(pearl);smooth(body)
sub=body.modifiers.new('Silhouette smoothing','SUBSURF');sub.levels=2;sub.render_levels=2
body.shape_key_add(name='Basis')
for name,sx,sz in [('Squash',1.09,.89),('Stretch',.93,1.12)]:
 key=body.shape_key_add(name=name,from_mix=False)
 for v,basis in zip(key.data,body.data.shape_keys.key_blocks['Basis'].data):
  v.co=(basis.co.x*sx,basis.co.y*sx,.3+(basis.co.z-.3)*sz)
eyes=[]
for x in [-.205,.205]:
 o=ellipsoid('Eye '+('L' if x<0 else 'R'),(x+.07,-.475,1.43),(.076,.028,.143),eye)
 for v in o.data.vertices:v.co.y+=.40*(v.co.z-1.43)-.023
 o.shape_key_add(name='Basis');key=o.shape_key_add(name='Blink')
 for v in key.data:v.co.z=1.43+(v.co.z-1.43)*.10
 eyes.append(o)
hands=[];feet=[]
for s in [-1,1]:
 o=ellipsoid('Hand '+('L' if s<0 else 'R'),(s*.83,-.22,.88),(.185,.15,.26),pearl)
 # Slight downward taper through a rounded hand; no mitten seam.
 hands.append(o)
 feet.append(ellipsoid('Foot '+('L' if s<0 else 'R'),(s*.29,-.12,.22),(.15,.20,.12),pearl))

arm=bpy.data.armatures.new('Droplet deform rig');rig=bpy.data.objects.new('Echo Droplet · Rig',arm);scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
def bone(name,head,tail,parent=None):
 b=arm.edit_bones.new(name);b.head=head;b.tail=tail
 if parent:b.parent=arm.edit_bones[parent]
 return b
bone('root',(0,0,0),(0,0,.25))
bone('body',(0,0,.3),(0,0,1.5),'root')
bone('tip',(0,0,1.45),(.40,0,2.32),'body')
for s,label in [(-1,'L'),(1,'R')]:
 bone('hand.'+label,(s*.68,-.06,1.03),(s*.92,-.09,.72),'body')
 bone('foot.'+label,(s*.29,0,.3),(s*.29,-.2,.12),'root')
bpy.ops.object.mode_set(mode='OBJECT');rig.show_in_front=True
def weight(obj,name):
 g=obj.vertex_groups.new(name=name);g.add(list(range(len(obj.data.vertices))),1,'REPLACE')
 m=obj.modifiers.new('Droplet rig','ARMATURE');m.object=rig;obj.parent=rig
weight(body,'body')
g=body.vertex_groups.new(name='tip')
for v in body.data.vertices:
 w=max(0,min(1,(v.co.z-1.45)/.8))*.7
 if w:g.add([v.index],w,'REPLACE');body.vertex_groups['body'].add([v.index],1-w,'REPLACE')
for o in eyes:weight(o,'body')
for i,label in enumerate(['L','R']):weight(hands[i],'hand.'+label);weight(feet[i],'foot.'+label)
for prop in ['blink','squash','stretch']:rig[prop]=0.0;rig.id_properties_ui(prop).update(min=0.0,max=1.0)
for obj,key,prop in [(body,'Squash','squash'),(body,'Stretch','stretch')]+[(o,'Blink','blink') for o in eyes]:
 d=obj.data.shape_keys.key_blocks[key].driver_add('value').driver;d.type='AVERAGE'
 v=d.variables.new();v.name=prop;v.type='SINGLE_PROP';v.targets[0].id=rig;v.targets[0].data_path='["'+prop+'"]'
for pb in rig.pose.bones:pb.rotation_mode='XYZ'

clips={'idle':96,'greet':48,'drag':48,'land':24,'work':72,'wait':72,'success':48}
rig.animation_data_create()
def bell(t,c,w):return max(0,1-abs(t-c)/w)**2
for clip,count in clips.items():
 action=bpy.data.actions.new('Echo_'+clip);action.use_fake_user=True;rig.animation_data.action=action
 for f in range(count):
  t=f/(count-1);a=math.tau*t
  for pb in rig.pose.bones:pb.location=(0,0,0);pb.rotation_euler=(0,0,0);pb.scale=(1,1,1)
  root=rig.pose.bones['root'];bod=rig.pose.bones['body'];tip=rig.pose.bones['tip'];hand=rig.pose.bones['hand.R'];wave=rig.pose.bones['hand.L']
  rig['blink']=max(bell(t,.37,.035),bell(t,.83,.03));rig['squash']=0.;rig['stretch']=0.
  bod.scale=(1+.008*math.sin(a),1+.008*math.sin(a),1+.015*math.sin(a))
  tip.rotation_euler.y=.025*math.sin(a)
  if clip=='idle':bod.rotation_euler.z=.025*math.sin(a);rig.pose.bones['hand.L'].rotation_euler.x=.025*math.sin(a)
  if clip=='greet':
   env=math.sin(math.pi*t)**.7;bod.rotation_euler.z=-.08*env
   wave.rotation_euler.z=1.95*env;wave.rotation_euler.x=.38*math.sin(5*math.pi*t)*env
   wave.location=wave.bone.matrix_local.to_3x3().inverted()@Vector((-.12,-.08,.02))*env
   root.location.y=.035*math.sin(math.pi*t);rig['blink']=bell(t,.14,.04)
  if clip=='drag':
   rig['stretch']=.75;bod.rotation_euler.y=.07*math.sin(a);tip.rotation_euler.y=.1*math.sin(a)
   rig.pose.bones['hand.L'].rotation_euler.z=.3+.13*math.sin(a);hand.rotation_euler.z=-.3+.13*math.sin(a)
   for side in ['L','R']:rig.pose.bones['foot.'+side].rotation_euler.x=.18*math.sin(a)
  if clip=='land':
   rig['squash']=.95*bell(t,.2,.2)+.22*bell(t,.65,.18);rig['stretch']=.28*bell(t,.43,.18);rig['blink']=.4*bell(t,.2,.15)
   root.location.y=.07*max(0,math.sin(2*math.pi*t))*math.sin(math.pi*t)
  if clip=='work':
   bod.rotation_euler.x=.10*math.sin(a)**2;bod.rotation_euler.z=.045*math.sin(a);tip.rotation_euler.y=.04*math.sin(a)
   hand.rotation_euler.x=.12*math.sin(a);hand.rotation_euler.z=-.12*math.sin(a)**2
  if clip=='wait':
   env=math.sin(math.pi*t)**2;bod.rotation_euler.z=.13*env;wave.rotation_euler.z=1.6*env;wave.rotation_euler.x=.14*math.sin(a)*env
   wave.location=wave.bone.matrix_local.to_3x3().inverted()@Vector((-.12,-.08,.02))*env
  if clip=='success':
   root.location.y=.24*math.sin(math.pi*t)**2;rig['squash']=.6*bell(t,.12,.12)+.65*bell(t,.85,.13);rig['stretch']=.45*bell(t,.4,.2)
   wave.rotation_euler.z=1.95*math.sin(math.pi*t);wave.rotation_euler.x=.4*math.sin(5*math.pi*t)*math.sin(math.pi*t)
   wave.location=wave.bone.matrix_local.to_3x3().inverted()@Vector((-.12,-.08,.02))*math.sin(math.pi*t)
   bod.rotation_euler.y=.07*math.sin(a);rig['blink']=bell(t,.87,.04)
  for pb in rig.pose.bones:
   for field in ['location','rotation_euler','scale']:pb.keyframe_insert(data_path=field,frame=f+1,group=pb.name)
  for prop in ['blink','squash','stretch']:rig.keyframe_insert(data_path='["'+prop+'"]',frame=f+1,group='Expression controls')
 action['clip']=clip;action['loop']=clip in ['idle','drag','work','wait'];action['fps']=24

def aim(o,p):o.rotation_euler=(Vector(p)-o.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(-2.5,-8,3.0));cam=bpy.context.object;cam.name='Portrait camera';cam.data.type='ORTHO';cam.data.ortho_scale=3.05;aim(cam,(0,0,1.27));scene.camera=cam
for name,loc,energy,size,col in [('Soft key',(-3,-4,5),480,4,(1,.96,.94)),('Warm fill',(3,-3,2),270,3,(1,.96,.94)),('Aqua rim',(-2,2,3),330,3,(.48,.88,1)),('Top sheen',(0,0,5),180,2,(1,1,1))]:
 bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.name=name;o.data.energy=energy;o.data.shape='DISK';o.data.size=size;o.data.color=col;aim(o,(0,0,1))
rig.animation_data.action=bpy.data.actions['Echo_idle'];scene.frame_start=1;scene.frame_end=96;scene.frame_set(1)
scene['asset']='Echo original pearl droplet';scene['animation_manifest']=json.dumps(clips);scene['notes']='Native companion: transparent atlas playback. Real task status is selected by companion-animation.js, never simulated in this asset.'
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);bpy.context.view_layer.objects.active=rig
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'Echo-Pearl-Droplet.blend'))
scene.render.resolution_x=512;scene.render.resolution_y=512;scene.cycles.samples=40
scene.render.filepath=str(OUT/'lookdev.png');bpy.ops.render.render(write_still=True)
(OUT/'model-evidence.json').write_text(json.dumps({'bones':[b.name for b in arm.bones],'actions':clips,'shapeKeys':['Blink','Squash','Stretch'],'resolution':320,'fps':24,'source':'Echo-Pearl-Droplet.blend'},indent=2),encoding='utf8')
