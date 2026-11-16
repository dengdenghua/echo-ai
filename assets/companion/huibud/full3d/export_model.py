"""Bake procedural PBR onto ordinary mesh UVs, never the concept image; export a real rigged GLB."""
import bpy,json,struct,hashlib
from pathlib import Path
R=Path(__file__).parent;s=bpy.context.scene;rig=bpy.data.objects[s['rig_object']];body=bpy.data.objects[s['skin_object']]
rig.animation_data.action=bpy.data.actions['Echo_idle'];s.frame_set(1)
bpy.ops.object.select_all(action='DESELECT');body.select_set(True);bpy.context.view_layer.objects.active=body
bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(angle_limit=1.15,island_margin=.012);bpy.ops.object.mode_set(mode='OBJECT')
material=body.data.materials[0];nodes=material.node_tree.nodes
s.cycles.samples=16;s.render.bake.margin=12;s.render.bake.use_pass_direct=False;s.render.bake.use_pass_indirect=False;s.render.bake.use_pass_color=True
images={};source_sha=hashlib.sha256((R/'Echo-Huibud-3D.blend').read_bytes()).hexdigest()
reuse=(R/'export-validation.json').exists() and json.loads((R/'export-validation.json').read_text())['sourceSha256']==source_sha
revision_path=R/'animation-revision.json'
if not reuse and revision_path.exists():
 revision=json.loads(revision_path.read_text());previous=json.loads((R/'export-validation.json').read_text())
 reuse=revision['sourceSha256']==source_sha and revision['previousSourceSha256']==previous['sourceSha256'] and revision['nonSuccessGeometryAndAnimationUnchanged'] and not revision['materialAndCameraEdited'] and all(hashlib.sha256((R/n).read_bytes()).hexdigest()==h for n,h in revision['textures'].items())
for name,kind in [('basecolor','DIFFUSE'),('normal','NORMAL')]:
 if reuse and (R/('huibud-'+name+'.png')).exists():
  images[name]=bpy.data.images.load(str(R/('huibud-'+name+'.png')))
  if kind=='NORMAL':images[name].colorspace_settings.name='Non-Color'
  continue
 image=bpy.data.images.new('Huibud procedural '+name,width=2048,height=2048,alpha=False)
 if kind=='NORMAL':image.colorspace_settings.name='Non-Color';s.render.bake.normal_space='TANGENT'
 texture=nodes.new('ShaderNodeTexImage');texture.image=image;nodes.active=texture;texture.select=True
 bpy.ops.object.bake(type=kind)
 image.filepath_raw=str(R/('huibud-'+name+'.png'));image.file_format='PNG';image.save();images[name]=image
 print('PROCEDURAL_BAKE_COMPLETE',name,flush=True)
realtime=bpy.data.materials.new('Huibud · baked procedural PBR');realtime.use_nodes=True
n=realtime.node_tree.nodes;l=realtime.node_tree.links;p=n.get('Principled BSDF')
p.inputs['Roughness'].default_value=.54;p.inputs['Specular IOR Level'].default_value=.22;p.inputs['Sheen Weight'].default_value=1;p.inputs['Sheen Tint'].default_value=(.20,.20,.20,1);p.inputs['Sheen Roughness'].default_value=.8
base=n.new('ShaderNodeTexImage');base.image=images['basecolor'];l.new(base.outputs['Color'],p.inputs['Base Color'])
normal=n.new('ShaderNodeTexImage');normal.image=images['normal'];normalmap=n.new('ShaderNodeNormalMap');normalmap.inputs['Strength'].default_value=1;l.new(normal.outputs['Color'],normalmap.inputs['Color']);l.new(normalmap.outputs['Normal'],p.inputs['Normal'])
body.data.materials.clear();body.data.materials.append(realtime)
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True)
for o in s.objects:
 if o.type=='MESH' and o.parent==rig:o.select_set(True)
bpy.context.view_layer.objects.active=rig
bpy.ops.export_scene.gltf(filepath=str(R/'Echo-Huibud-3D.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='ACTIONS',export_force_sampling=True,export_bake_animation=True,export_anim_single_armature=True,export_morph_animation=True,export_apply=False,export_extras=True)
raw=(R/'Echo-Huibud-3D.glb').read_bytes();length,kind=struct.unpack_from('<II',raw,12);data=json.loads(raw[20:20+length])
animations=[a['name'] for a in data.get('animations',[])];assert len(animations)>=7,animations
assert data.get('skins') and data.get('meshes')
evidence={'ok':True,'sourceSha256':hashlib.sha256((R/'Echo-Huibud-3D.blend').read_bytes()).hexdigest(),'glbSha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw),'animations':animations,'skinCount':len(data['skins']),'meshCount':len(data['meshes']),'materialSource':'UV baking of procedural 3D PBR only; no reference projection','note':'Realtime PBR approximates the Cycles sheen/subsurface lighting. Blender source is authoritative.'}
(R/'export-validation.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(evidence))
