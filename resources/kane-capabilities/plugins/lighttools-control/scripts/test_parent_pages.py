"""Parent pages preserve native associations; final page is not full-domain coverage."""
from lighttools_control.bridge import Session
class Native:
 def __init__(self):self.alive=set();self.index=0;self.deleted=[]
 def DbList(self,root,kind):
  if root=='root':self.index=0;key='parents'
  else:assert root.startswith('parent-') and 'parents' in self.alive;key='children-'+root
  self.alive.add(key);return key,0
 def ListSize(self,key):return (4 if key=='parents' else 1),0
 def ListNext(self,key):
  assert key in self.alive
  if key=='parents':self.index+=1;return 'parent-'+str(self.index),0
  return 'child-'+key.removeprefix('children-parent-'),0
 def DbKeyStr(self,key):return 'same display name',0
 def DbGet(self,key,field,status,i,j):
  assert 'parents' in self.alive
  if key.startswith('child-'):assert 'children-parent-'+key.split('-')[-1] in self.alive
  return int(key.split('-')[-1]),0
 def ListDelete(self,key):self.alive.remove(key);self.deleted.append(key);return 0
n=Native();s=Session.__new__(Session);s.lt=n
first=s.read_child_fields('root','p',['id'],'c',['id'],2,2)
last=s.read_child_fields('root','p',['id'],'c',['id'],2,2,2)
assert first['truncated'] and not first['all_parents_returned']
assert not last['truncated'] and not last['all_parents_returned'] and last['parent_offset']==2
combined=first['objects']+last['objects'];assert [x['index'] for x in combined]==[1,2,3,4]
assert all(x['fields']['id']['value']==x['children'][0]['fields']['id']['value'] for x in combined)
assert not n.alive and n.deleted.count('parents')==2
print('PASS page offsets, parent-child identity, end-page vs whole-domain distinction, cleanup')
