"""Huibud B: a complete volumetric character, with procedural PBR materials.
No reference image is sampled by a material. Back/hidden geometry is an interpretation.
Run only in an isolated background Blender process.
"""
import bpy,bmesh,math,json,hashlib
import numpy as np
from pathlib import Path
from mathutils import Vector,Quaternion
from mathutils.kdtree import KDTree
R=Path(__file__).resolve().parent
if not bpy.app.background:raise RuntimeError('Use an isolated background Blender process')
bpy.ops.wm.read_factory_settings(use_empty=True);bpy.context.preferences.filepaths.save_version=0
s=bpy.context.scene;s.name='Huibud B · complete 3D character'
s.render.engine='CYCLES';s.cycles.device='CPU';s.cycles.samples=32;s.cycles.use_denoising=True;s.cycles.seed=17
s.render.threads_mode='FIXED';s.render.threads=4;s.render.fps=24
s.render.resolution_x=320;s.render.resolution_y=320;s.render.resolution_percentage=100
s.render.image_settings.file_format='PNG';s.render.image_settings.color_mode='RGBA';s.render.film_transparent=True
s.view_settings.view_transform='Standard';s.view_settings.look='None';s.view_settings.exposure=-.15
s.world=bpy.data.worlds.new('Ivory studio');s.world.use_nodes=True
s.world.node_tree.nodes['Background'].inputs['Color'].default_value=(1,.94,.87,1)
s.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.34

def mat(name,color,rough):
 m=bpy.data.materials.new(name);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=rough
 return m,p
ivory,p=mat('Warm ivory · microfibre PBR',(.86,.765,.69),.54)
p.inputs['Subsurface Weight'].default_value=.085;p.inputs['Subsurface Radius'].default_value=(1,.68,.45);p.inputs['Subsurface Scale'].default_value=.035
p.inputs['Specular IOR Level'].default_value=.22;p.inputs['Sheen Weight'].default_value=.20;p.inputs['Sheen Roughness'].default_value=.8
n=ivory.node_tree.nodes;l=ivory.node_tree.links
noise=n.new('ShaderNodeTexNoise');noise.name='True 3D micrograin';noise.inputs['Scale'].default_value=330;noise.inputs['Detail'].default_value=2;noise.inputs['Roughness'].default_value=.7
bump=n.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.18;bump.inputs['Distance'].default_value=.003
l.new(noise.outputs['Fac'],bump.inputs['Height']);l.new(bump.outputs['Normal'],p.inputs['Normal'])
attr=n.new('ShaderNodeVertexColor');attr.layer_name='CurlMint'
mix=n.new('ShaderNodeMixRGB');mix.inputs[1].default_value=(.86,.765,.69,1);mix.inputs[2].default_value=(.39,.54,.415,1)
l.new(attr.outputs['Color'],mix.inputs[0])
grain=n.new('ShaderNodeMapRange');grain.inputs['From Min'].default_value=0;grain.inputs['From Max'].default_value=1;grain.inputs['To Min'].default_value=.985;grain.inputs['To Max'].default_value=1.01;l.new(noise.outputs['Fac'],grain.inputs[0])
grained=n.new('ShaderNodeMixRGB');grained.blend_type='MULTIPLY';grained.inputs[0].default_value=1;l.new(mix.outputs[0],grained.inputs[1]);l.new(grain.outputs[0],grained.inputs[2]);l.new(grained.outputs[0],p.inputs['Base Color'])
eye,ep=mat('Obsidian eyes · solid geometry',(.006,.0045,.0037),.23)
ep.inputs['IOR'].default_value=1.46;ep.inputs['Coat Weight'].default_value=.12;ep.inputs['Coat Roughness'].default_value=.21
mouthmat,mp=mat('Warm charcoal smile',(.025,.016,.011),.6);mp.inputs['Specular IOR Level'].default_value=.15

def active(o):
 bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
def smooth(o):
 for p in o.data.polygons:p.use_smooth=True
def smoothstep(a,b,x):
 t=np.clip((x-a)/(b-a),0,1);return t*t*(3-2*t)
def mesh_obj(name,verts,faces):
 me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.update();o=bpy.data.objects.new(name,me);s.collection.objects.link(o);smooth(o);return o
def sampled_curve(points,steps=6):
 a=np.array(points,dtype=float);out=[]
 for i in range(len(a)-1):
  p0,p1,p2,p3=[a[max(0,min(len(a)-1,j))] for j in (i-1,i,i+1,i+2)]
  for t in np.linspace(0,1,steps,endpoint=False):out.append(.5*((2*p1)+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t*t+(-p0+3*p1-3*p2+p3)*t*t*t))
 out.append(a[-1]);return np.array(out)
# Model neutral anatomical volumes. The B reference tilt belongs to the pose,
# never to the cross sections of the torso/head.
def ellipsoid(name,center,radius,pear=0):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=64,ring_count=48)
 o=bpy.context.object;o.name=name
 for v in o.data.vertices:
  x,y,z=v.co;shape=1-pear*z
  v.co=(center[0]+radius[0]*shape*x,center[1]+radius[1]*shape*y,center[2]+radius[2]*z)
 smooth(o);return o
# A single neutral sculpted head/torso: concentric elliptical cross sections.
# The waist is deliberately broad; no separate spherical head or pinched neck.
profile=sampled_curve([
 (.13,.015,.015),(.18,.25,.22),(.27,.43,.35),(.43,.53,.43),
 (.62,.55,.46),(.78,.51,.445),(.90,.49,.44),(1.02,.56,.495),
 (1.16,.67,.59),(1.34,.77,.675),(1.53,.79,.695),(1.71,.73,.645),
 (1.88,.60,.53),(2.02,.43,.38),(2.13,.25,.23),(2.21,.14,.14),
 (2.28,.065,.065),(2.31,.002,.002)],8)
verts=[];faces=[];segments=96
for z,rx,ry in profile:
 for i in range(segments):
  angle=math.tau*i/segments;verts.append((max(.001,rx)*math.cos(angle),max(.001,ry)*math.sin(angle),z))
for j in range(len(profile)-1):
 for i in range(segments):
  a=j*segments+i;b=j*segments+(i+1)%segments;faces.append((a,b,b+segments,a+segments))
faces.extend([tuple(reversed(range(segments))),tuple((len(profile)-1)*segments+i for i in range(segments))])
body=mesh_obj('Huibud continuous skin',verts,faces)
parts=[(body,'body')]
arm_paths={side:[(sign*x,y,z,r) for x,y,z,r in
 [(.46,-.10,.86,.115),(.59,-.20,.76,.105),(.64,-.32,.65,.115),
  (.64,-.40,.54,.12),(.62,-.44,.46,.105),(.60,-.45,.405,.002)]]
 for side,sign in [('L',-1),('R',1)]}

def tube(name,path):
 centers=sampled_curve(path,6);v=[];f=[];sides=32
 for j,(x,y,z,radius) in enumerate(centers):
  a=centers[max(0,j-1),:3];b=centers[min(len(centers)-1,j+1),:3];t=Vector(b-a).normalized();u=t.cross(Vector((0,1,0))).normalized();w=t.cross(u).normalized()
  for i in range(sides):
   angle=i*math.tau/sides;v.append(tuple(Vector((x,y,z))+float(max(.001,radius))*(math.cos(angle)*u+math.sin(angle)*w)))
 for j in range(len(centers)-1):
  for i in range(sides):a=j*sides+i;b=j*sides+(i+1)%sides;f.append((a,b,b+sides,a+sides))
 f.extend([tuple(reversed(range(sides))),tuple((len(centers)-1)*sides+i for i in range(sides))]);return mesh_obj(name,v,f)
curl_path=[(0,0,2.13,.17),(.055,0,2.25,.13),(.14,0,2.32,.10),(.235,0,2.33,.073),(.29,0,2.29,.05),(.295,0,2.245,.018),(.29,0,2.23,.002)]
parts.append((tube('Sculpted curl',curl_path),'curl'))
for side,path in arm_paths.items():parts.append((tube('Shoulder and paw '+side,path),'arm.'+side))
foot_centers={}
for side,center,radius in [('L',(-.225,-.13,.105),(.205,.255,.105)),('R',(.225,-.13,.105),(.205,.255,.105))]:
 bpy.ops.mesh.primitive_uv_sphere_add(segments=48,ring_count=24,location=center);o=bpy.context.object;o.name='Foot volume '+side;o.scale=radius
 bpy.ops.object.transform_apply(location=True,rotation=True,scale=True);smooth(o);parts.append((o,'foot.'+side));foot_centers[side]=center

names=['body','head','tip','arm.L','paw.L','arm.R','paw.R','foot.L','toe.L','foot.R','toe.R']
source_positions=[];source_weights=[]
for o,region in parts:
 for vertex in o.data.vertices:
  x,y,z=vertex.co;w=np.zeros(len(names))
  if region in ['body','head','curl']:
   h=float(smoothstep(.76,1.28,z));tip=float(smoothstep(2.16,2.34,z));w[0]=1-h;w[1]=h*(1-tip);w[2]=h*tip
  elif region.startswith('arm'):
   side=region[-1];idx=names.index(region);distal=float(1-smoothstep(.50,.66,z));attach=float(1-smoothstep(.72,.84,z));w[0]=1-attach;w[idx]=attach*(1-distal);w[idx+1]=attach*distal
  else:
   side=region[-1];idx=names.index(region);leg=float(1-smoothstep(.18,.30,z));toe=float(1-smoothstep(-.32,-.17,y))*.65;w[0]=1-leg;w[idx]=leg*(1-toe);w[idx+1]=leg*toe
  source_positions.append(vertex.co.copy());source_weights.append(w)
tree=KDTree(len(source_positions))
for i,v in enumerate(source_positions):tree.insert(v,i)
tree.balance();source_weights=np.array(source_weights)
bpy.ops.object.select_all(action='DESELECT')
for o,_ in parts:o.select_set(True)
bpy.context.view_layer.objects.active=body;bpy.ops.object.join()
body.data.remesh_voxel_size=.010;body.data.use_remesh_fix_poles=True
bpy.ops.object.voxel_remesh()
relax=body.modifiers.new('Sculpted shoulder and ankle transitions','SMOOTH');relax.factor=.58;relax.iterations=22;bpy.ops.object.modifier_apply(modifier=relax.name)
smooth(body);body.data.materials.clear();body.data.materials.append(ivory)
positions=np.array([tuple(v.co) for v in body.data.vertices]);weights=np.zeros((len(positions),len(names)))
for i,v in enumerate(body.data.vertices):
 hits=tree.find_n(v.co,4);f=np.array([1/max(d,.003)**2 for _,_,d in hits]);f/=f.sum();weights[i]=sum(source_weights[j]*a for (_,j,_),a in zip(hits,f))
edges=np.array([tuple(e.vertices) for e in body.data.edges]);src=np.concatenate([edges[:,0],edges[:,1]]);dst=np.concatenate([edges[:,1],edges[:,0]]);degree=np.bincount(dst,minlength=len(positions)).clip(1)
for _ in range(220):
 average=np.zeros_like(weights)
 for i in range(len(names)):average[:,i]=np.bincount(dst,weights=weights[src,i],minlength=len(positions))/degree
 weights=.68*weights+.32*average
weights/=weights.sum(axis=1)[:,None]
for j,name in enumerate(names):
 group=body.vertex_groups.new(name=name)
 for i,value in enumerate(weights[:,j]):
  if value>1e-6:group.add([i],float(value),'REPLACE')
color=body.data.color_attributes.new(name='CurlMint',type='FLOAT_COLOR',domain='POINT')
for v,c in zip(body.data.vertices,color.data):
 x,y,z=v.co;f=float(smoothstep(2.17,2.31,z)*smoothstep(.015,.15,x))
 # Mint is sculpted colour on the curl's inner/right side, fading around its back.
 f*=.82; c.color=(f,f,f,1)

# Place solid eye geometry and a tubular smile on the real curved head surface.
def surface(x,z):
 rx=float(np.interp(z,profile[:,0],profile[:,1]));ry=float(np.interp(z,profile[:,0],profile[:,2]))
 return -ry*math.sqrt(max(.005,1-(x/rx)**2))

def point_normal(x,z):
 e=.003;normal=Vector(((surface(x+e,z)-surface(x-e,z))/(2*e),-1,(surface(x,z+e)-surface(x,z-e))/(2*e))).normalized()
 return Vector((x,surface(x,z),z)),normal
eyes=[];tilt=0
for name,x,z,rx in [('L',-.31,1.48,.057),('R',.31,1.48,.057)]:
 center,normal=point_normal(x,z);up=Vector((-math.sin(tilt),0,math.cos(tilt)));up=(up-normal*up.dot(normal)).normalized();horizontal=up.cross(normal).normalized()
 bpy.ops.mesh.primitive_uv_sphere_add(segments=48,ring_count=32);o=bpy.context.object;o.name='Solid eye '+name
 for v in o.data.vertices:
  local=v.co.copy();v.co=center+normal*.003+horizontal*(local.x*rx)+normal*(local.y*.027)+up*(local.z*.075)
 o.data.materials.append(eye);smooth(o);o.shape_key_add(name='Basis');key=o.shape_key_add(name='Blink')
 for v,b in zip(key.data,o.data.shape_keys.key_blocks['Basis'].data):v.co=b.co-up*(b.co-center).dot(up)*.91
 eyes.append(o)
curve=bpy.data.curves.new('Volumetric smile','CURVE');curve.dimensions='3D';curve.bevel_depth=.008;curve.bevel_resolution=4
line=curve.splines.new('POLY');line.points.add(32)
for i,p in enumerate(line.points):
 u=(i/32-.5)*.16;x=u*math.cos(tilt);z=1.315+u*math.sin(tilt)+.025*(u/.08)**2;v,n=point_normal(x,z);p.co=(*(v+n*.004),1)
mouth=bpy.data.objects.new('Sculpted smile',curve);s.collection.objects.link(mouth);mouth.data.materials.append(mouthmat);active(mouth);bpy.ops.object.convert(target='MESH');mouth=bpy.context.object
arm=bpy.data.armatures.new('Huibud full-body deformation rig');rig=bpy.data.objects.new('Echo Huibud 3D Rig',arm);s.collection.objects.link(rig);active(rig);bpy.ops.object.mode_set(mode='EDIT')
def bone(name,a,b,parent=None):
 e=arm.edit_bones.new(name);e.head=a;e.tail=b
 if parent:e.parent=arm.edit_bones[parent]
bone('root',(0,0,0),(0,0,.10));bone('body',(0,0,.15),(0,0,.90),'root');bone('head',(0,0,.90),(0,0,2.0),'body');bone('tip',(.015,0,2.16),(.23,0,2.34),'head')
for side,path in arm_paths.items():
 shoulder=path[0][:3];elbow=path[2][:3];paw=path[-2][:3]
 bone('arm.'+side,shoulder,elbow,'body');bone('paw.'+side,elbow,paw,'arm.'+side)
for side,center in foot_centers.items():
 x,y,z=center;bone('foot.'+side,(x,y+.08,.17),(x,y-.06,.07),'root');bone('toe.'+side,(x,y-.06,.07),(x,y-.18,.055),'foot.'+side)
bpy.ops.object.mode_set(mode='OBJECT');rig.show_in_front=True
def attach(o,group=None):
 if group:g=o.vertex_groups.new(name=group);g.add(list(range(len(o.data.vertices))),1,'REPLACE')
 mod=o.modifiers.new('Continuous weighted deformation','ARMATURE');mod.object=rig;mod.use_deform_preserve_volume=True;o.parent=rig
attach(body)
for o in eyes+[mouth]:attach(o,'head')
sub=body.modifiers.new('Soft final surface','SUBSURF');sub.levels=1;sub.render_levels=1
rig['blink']=0.;rig.id_properties_ui('blink').update(min=0.,max=1.)
for o in eyes:
 d=o.data.shape_keys.key_blocks['Blink'].driver_add('value').driver;d.type='AVERAGE';v=d.variables.new();v.name='blink';v.type='SINGLE_PROP';v.targets[0].id=rig;v.targets[0].data_path='["blink"]'
for b in rig.pose.bones:b.rotation_mode='XYZ'
clips={'idle':96,'greet':48,'drag':48,'land':24,'work':72,'wait':72,'success':48};rig.animation_data_create()
def bell(t,c,w):return max(0,1-abs(t-c)/w)**2
def turn_world(b,axis,angle):
 basis=b.bone.matrix_local.to_quaternion();b.rotation_euler=(basis.inverted()@Quaternion(axis,angle)@basis).to_euler('XYZ')
for clip,count in clips.items():
 action=bpy.data.actions.new('Echo_'+clip);action.use_fake_user=True;rig.animation_data.action=action
 for f in range(count):
  t=f/(count-1);a=math.tau*t;env=math.sin(math.pi*t)**2
  for b in rig.pose.bones:b.location=(0,0,0);b.rotation_euler=(0,0,0);b.scale=(1,1,1)
  root=rig.pose.bones['root'];torso=rig.pose.bones['body'];head=rig.pose.bones['head'];armL=rig.pose.bones['arm.L'];pawL=rig.pose.bones['paw.L']
  rig['blink']=max(bell(t,.37,.035),bell(t,.83,.03));torso.scale=(1+.004*math.sin(a),1+.007*math.sin(a),1+.004*math.sin(a));head.rotation_euler.z=.014*math.sin(a)
  rig.pose.bones['tip'].rotation_euler.z=.018*math.sin(a-.3)*math.sin(math.pi*t)
  if clip=='greet':
   turn_world(armL,(0,1,0),.95*env);turn_world(pawL,(0,1,0),.17*math.sin(5*math.pi*t)*env);head.rotation_euler.z+=.055*env
  elif clip=='drag':
   root.scale=(.975,1.05,.975);armL.rotation_euler.z=.15+.06*math.sin(a);rig.pose.bones['arm.R'].rotation_euler.z=-.13;head.rotation_euler.z=.025*math.sin(a)
   for side,phase in [('L',0),('R',1.2)]:rig.pose.bones['foot.'+side].rotation_euler.x=.09*math.sin(a+phase)
  elif clip=='land':
   squash=.8*bell(t,.20,.20)+.14*bell(t,.68,.18);stretch=.23*bell(t,.44,.19);root.scale=(1+.045*squash-.02*stretch,1-.075*squash+.06*stretch,1+.045*squash-.02*stretch);head.rotation_euler.x=.025*math.sin(a)*env
  elif clip=='work':
   head.rotation_euler.x=.045*env;armL.rotation_euler.x=.13*env;pawL.rotation_euler.z=.06*math.sin(2*a);rig.pose.bones['arm.R'].rotation_euler.x=.08*env
  elif clip=='wait':
   head.rotation_euler.z=.09*env;armL.rotation_euler.z=.32*env;pawL.rotation_euler.x=.08*env
  elif clip=='success':
   hop=.08*math.sin(math.pi*t)**2;root.location.y=hop;turn_world(armL,(0,1,0),.9*env);turn_world(rig.pose.bones['arm.R'],(0,1,0),-.45*env);turn_world(pawL,(0,1,0),.12*math.sin(5*math.pi*t)*env)
   squash=.45*bell(t,.10,.10)+.45*bell(t,.89,.11);root.scale=(1+.04*squash,1-.06*squash,1+.04*squash)
   for side in ['L','R']:rig.pose.bones['foot.'+side].rotation_euler.x=.10*env;rig.pose.bones['toe.'+side].rotation_euler.x=-.05*env
  # B's apparent lean is a reversible pose on an upright, balanced neutral model.
  basis=head.bone.matrix_local.to_quaternion()
  head.rotation_euler=(basis.inverted()@Quaternion((0,1,0),-.22)@basis@head.rotation_euler.to_quaternion()).to_euler('XYZ')
  turn_world(root,(0,0,1),-.30)
  for b in rig.pose.bones:
   for field in ['location','rotation_euler','scale']:b.keyframe_insert(data_path=field,frame=f+1,group=b.name)
  rig.keyframe_insert(data_path='["blink"]',frame=f+1,group='Face')
 action['clip']=clip;action['loop']=clip in ['idle','drag','work','wait'];action['fps']=24

def aim(o,p):o.rotation_euler=(Vector(p)-o.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(0,-8,1.18));cam=bpy.context.object;cam.name='Reference portrait';cam.data.type='ORTHO';cam.data.ortho_scale=2.85;aim(cam,(0,0,1.18));s.camera=cam
eye_receivers=bpy.data.collections.new('Eye highlight receivers');s.collection.children.link(eye_receivers)
for eye_object in eyes:eye_receivers.objects.link(eye_object)
for name,pos,power,size,color in [('Large softbox',(-3.3,-4.1,4.9),350,3.3,(1,.97,.95)),('Front fill',(3.7,-4,2.5),210,4.0,(1,.98,.96)),('Silhouette rim',(-2.3,2.5,3.8),180,3.0,(1,.98,.95)),('Small eye highlight',(-1.8,-3.0,3.5),150,1.35,(1,1,1)),('Right eye highlight',(2.2,-3.0,3.5),100,1.1,(1,1,1))]:
 bpy.ops.object.light_add(type='AREA',location=pos);o=bpy.context.object;o.name=name;o.data.energy=power;o.data.size=size;o.data.shape='DISK';o.data.color=color;aim(o,(0,0,1.2))
 if 'eye highlight' not in name:o.visible_glossy=False
 else:o.data.diffuse_factor=0;o.data.volume_factor=0;o.light_linking.receiver_collection=eye_receivers
rig.animation_data.action=bpy.data.actions['Echo_idle'];s.frame_start=1;s.frame_end=96;s.frame_set(1)
s['asset']='回芽 B · complete volumetric 3D';s['rig_object']=rig.name;s['skin_object']=body.name;s['animation_manifest']=json.dumps(clips);s['reference_projection']=False;s['neutral_construction']='Continuous neutral sculpted head/torso, short curved paws; tilt only in the pose';s['back_geometry']='Artist interpretation of unseen B back, following the same design'
bm=bmesh.new();bm.from_mesh(body.data);bm.verts.ensure_lookup_table();assert all(e.is_manifold for e in bm.edges),'Skin must be watertight'
seen=set();todo=[bm.verts[0]]
while todo:
 v=todo.pop()
 if v in seen:continue
 seen.add(v);todo.extend(e.other_vert(v) for e in v.link_edges if e.other_vert(v) not in seen)
components=1 if len(seen)==len(bm.verts) else 2
assert components==1,('Detached body/limb volume',len(seen),len(bm.verts))
bm.free()
assert not any(n.type in ['TEX_IMAGE','EMISSION'] for m in bpy.data.materials if m.use_nodes for n in m.node_tree.nodes)
active(rig);bpy.ops.wm.save_as_mainfile(filepath=str(R/'Echo-Huibud-3D.blend'))
evidence={'source':'Echo-Huibud-3D.blend','technique':'complete volumetric 3D with procedural PBR materials','referenceProjection':False,'imageTextureNodes':0,'emissionNodes':0,'skinConnectedComponents':1,'watertight':True,'skinVertices':len(body.data.vertices),'skinFaces':len(body.data.polygons),'bones':list(arm.bones.keys()),'actions':clips,'eyeGeometry':'solid ellipsoids','mouthGeometry':'solid tube','hiddenBack':'interpreted from visible design; no reference provided','neutralConstruction':'symmetrical volumetric anatomy; reference tilt is pose only','headRestWidth':1.58,'headRestDepth':1.39,'headDepthWidthRatio':1.39/1.58}
(R/'model-evidence.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2),encoding='utf-8')
s.render.resolution_x=640;s.render.resolution_y=640;s.cycles.samples=64;s.render.filepath=str(R/'lookdev.png');bpy.ops.render.render(write_still=True)
print('FULL_3D_BUILD_COMPLETE',json.dumps(evidence,ensure_ascii=False))
