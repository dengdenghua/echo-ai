from PIL import Image,ImageChops,ImageStat,ImageDraw
from pathlib import Path
import json,math,hashlib
OUT=Path(__file__).parent
dest=OUT/'assets';dest.mkdir(exist_ok=True)
clips=json.loads((OUT/'model-evidence.json').read_text())['actions']
manifest={'version':1,'fps':24,'renderer':'Blender Cycles','sourceSha256':hashlib.sha256((OUT/'Echo-Pearl-Droplet.blend').read_bytes()).hexdigest(),'clips':{}}
checks=[]
for clip,count in clips.items():
 paths=[OUT/'frames'/clip/f'{f:03d}.png' for f in range(count)]
 assert all(p.exists() for p in paths),(clip,'incomplete renders')
 frames=[Image.open(p).convert('RGBA') for p in paths]
 columns=8;size=320;rows=math.ceil(count/columns)
 atlas=Image.new('RGBA',(columns*size,rows*size))
 bounds=[]
 for f,img in enumerate(frames):
  assert img.size==(size,size)
  alpha=img.getchannel('A');assert alpha.getextrema()==(0,255)
  box=alpha.point(lambda x:255 if x>8 else 0).getbbox();assert box and box[0]>1 and box[1]>1 and box[2]<size-1 and box[3]<size-1,(clip,f,'cropped',box)
  bounds.append(box);atlas.paste(img,((f%columns)*size,(f//columns)*size))
 atlas.save(dest/(clip+'.webp'),lossless=True,method=4)
 # Export a portable transparent animated preview alongside the runtime atlas.
 frames[0].save(OUT/(clip+'-animation.webp'),save_all=True,append_images=frames[1:],duration=[42 if f%3 else 41 for f in range(count)],loop=0,lossless=True,method=4)
 decoded=Image.open(dest/(clip+'.webp')).convert('RGBA')
 assert decoded.size==atlas.size
 for f,img in enumerate(frames):
  roundtrip=decoded.crop(((f%columns)*size,(f//columns)*size,(f%columns+1)*size,(f//columns+1)*size))
  # WebP may normalize RGB under fully transparent pixels; visible composites must be exact.
  for bg in ['white','#172b40']:
   a=Image.new('RGBA',img.size,bg);a.alpha_composite(img)
   b=Image.new('RGBA',img.size,bg);b.alpha_composite(roundtrip)
   assert ImageChops.difference(a.convert('RGB'),b.convert('RGB')).getbbox() is None,(clip,f,'atlas mismatch')
 hashes={hashlib.sha256(im.tobytes()).hexdigest() for im in frames}
 assert len(hashes)>count//2,(clip,'not animated')
 loopError=None
 if clip in ['idle','drag','work','wait']:
  a=Image.new('RGBA',frames[0].size,'white');a.alpha_composite(frames[0])
  b=Image.new('RGBA',frames[-1].size,'white');b.alpha_composite(frames[-1])
  loopError=max(ImageStat.Stat(ImageChops.difference(a.convert('RGB'),b.convert('RGB'))).mean)
  assert loopError<.8,(clip,'loop seam',loopError)
 manifest['clips'][clip]={'file':clip+'.webp','frames':count,'size':size,'columns':columns,'loop':clip in ['idle','drag','work','wait']}
 checks.append({'clip':clip,'frames':count,'uniqueFrames':len(hashes),'loopMeanPixelError':loopError,'alpha':'transparent RGBA','bounds':list(map(list,[tuple(min(b[i] for b in bounds) for i in [0,1])+tuple(max(b[i] for b in bounds) for i in [2,3])])),'bytes':(dest/(clip+'.webp')).stat().st_size})
 for im in frames:im.close()
 (OUT/'export-progress.json').write_text(json.dumps(checks,indent=2))
(dest/'animations.js').write_text('window.EchoCompanionAssets='+json.dumps(manifest,separators=(',',':'))+';\n',encoding='utf8')
(OUT/'asset-validation.json').write_text(json.dumps({'ok':True,'checks':checks,'manifest':manifest},indent=2),encoding='utf8')
print(json.dumps({'ok':True,'clips':len(checks),'frames':sum(clips.values()),'atlasBytes':sum(x['bytes'] for x in checks)}))
