"""Preview/apply an explicit task-owned superseded-file manifest. Never discover deletions by glob."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
from datetime import datetime, timezone

def digest(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
    return h.hexdigest()

def checked_path(raw, root):
    p=Path(raw)
    if not p.is_absolute():raise ValueError('Every file path must be absolute')
    lexical=Path(os.path.abspath(p))
    resolved=p.resolve(strict=True)
    try:resolved.relative_to(root)
    except ValueError:raise ValueError('Path leaves the declared task root')
    q=lexical
    while True:
        st=q.lstat()
        if q.is_symlink() or getattr(st,'st_file_attributes',0)&0x400:raise ValueError('Links/junctions/reparse points are not allowed')
        if q.resolve()==root:break
        if q==q.parent:raise ValueError('Could not establish lexical task boundary')
        q=q.parent
    if not resolved.is_file():raise ValueError('Only explicit ordinary files may be removed')
    return resolved

def validate(m):
    if m.get('schema')!='engineering.retention.v1':raise ValueError('Wrong manifest schema')
    root=Path(m['root'])
    if not root.is_absolute():raise ValueError('Root must be absolute')
    root=root.resolve(strict=True)
    if root==Path(root.anchor) or root==Path.home().resolve():raise ValueError('Root must be a concrete task directory')
    kept={};seen=set()
    for r in m['retain']:
        p=checked_path(r['path'],root)
        if str(p).casefold() in seen:raise ValueError('Duplicate retained path')
        seen.add(str(p).casefold())
        if not r.get('reason') or digest(p)!=r['sha256'].lower():raise ValueError('Retained-file reason or hash invalid')
        kept[str(p).casefold()]=r
    pending=[]
    for r in m['remove']:
        p=checked_path(r['path'],root);pk=str(p).casefold()
        if pk in seen:raise ValueError('Duplicate or retained removal target')
        seen.add(pk)
        if r.get('task_owned') is not True or r.get('role')!='superseded_generated' or not r.get('reason'):
            raise ValueError('Only explicitly task-owned superseded generated files are eligible')
        replacement=checked_path(r['superseded_by'],root);replacement_entry=kept.get(str(replacement).casefold())
        if not replacement_entry or replacement_entry.get('validated') is not True:
            raise ValueError('Replacement must be retained and explicitly validated')
        evidence=checked_path(replacement_entry['validation_evidence'],root)
        if evidence.stat().st_size==0:raise ValueError('Empty replacement validation evidence')
        if digest(p)!=r['sha256'].lower():raise ValueError('Removal target changed since classification')
        pending.append({'path':str(p),'sha256':r['sha256'].lower(),'bytes':p.stat().st_size,'reason':r['reason'],'superseded_by':str(replacement)})
    return root,pending

def run(manifest, apply=False, journal=None):
    m=json.loads(Path(manifest).read_text(encoding='utf-8-sig'));root,pending=validate(m)
    out={'schema':'engineering.cleanup-result.v1','timestamp':datetime.now(timezone.utc).isoformat(),
         'manifest':str(Path(manifest).resolve()),'root':str(root),'preview':not apply,
         'planned_bytes':sum(r['bytes'] for r in pending),'removed_bytes':0,'files':pending,
         'disk_free_before':shutil.disk_usage(root).free,'status':'preview'}
    if not apply:return out
    if not journal:raise ValueError('Apply requires a new explicit journal path')
    jp=Path(journal)
    if not jp.is_absolute():raise ValueError('Journal path must be absolute')
    jp=jp.resolve();jp.relative_to(root)
    if str(jp).casefold() in {str(Path(r['path']).resolve()).casefold() for r in m['retain']+m['remove']}:
        raise ValueError('Journal collides with manifest members')
    # Create the journal before deletion; preserve partial progress on any failure.
    with jp.open('x',encoding='utf8') as f:json.dump(out,f,ensure_ascii=False,indent=2)
    try:
        for r in pending:
            p=checked_path(r['path'],root)
            if digest(p)!=r['sha256']:raise ValueError('File changed immediately before deletion')
            p.unlink();r['deleted']=True;out['removed_bytes']+=r['bytes']
            jp.write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf8')
        for r in m['retain']:
            if digest(checked_path(r['path'],root))!=r['sha256'].lower():raise ValueError('Retained file changed')
        out['status']='completed'
    except Exception as exc:
        out.update(status='partial_or_failed',error=str(exc));raise
    finally:
        out['disk_free_after']=shutil.disk_usage(root).free
        jp.write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf8')
    return out

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('manifest');ap.add_argument('--apply',action='store_true');ap.add_argument('--journal')
    a=ap.parse_args();print(json.dumps(run(a.manifest,a.apply,a.journal),ensure_ascii=False,indent=2))
