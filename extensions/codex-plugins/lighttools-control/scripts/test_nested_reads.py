"""Verify nested handle identity, cleanup and checked partial failures without COM."""
from lighttools_control.bridge import Session

class Native:
    def __init__(self, fail=False):
        self.alive=set();self.deleted=[];self.fail=fail
    def DbList(self, root, kind):
        assert root=='root' or (root=='parent-handle' and 'parents' in self.alive)
        key='parents' if root=='root' else 'children';self.alive.add(key);return key,0
    def ListSize(self, key):
        assert key in self.alive;return 1,0
    def ListNext(self, key):
        assert key in self.alive
        if key=='children' and self.fail:raise RuntimeError('child traversal failure')
        return ('parent-handle' if key=='parents' else 'child-handle'),0
    def DbKeyStr(self, key):return 'identical ambiguous display path',0
    def DbGet(self, key, field, status, i, j):
        assert 'parents' in self.alive
        if key=='child-handle':assert 'children' in self.alive
        assert key in ['parent-handle','child-handle']
        if field=='bad':return None,30
        return (95 if key=='parent-handle' else 550),0
    def ListDelete(self, key):self.alive.remove(key);self.deleted.append(key);return 0
    def GetLastMsg(self, n):return 'invalid field',0

def run():
    native=Native();session=Session.__new__(Session);session.lt=native
    result=session.read_child_fields('root','parent',['count'],'child',['wavelength','bad'],10,100)
    row=result['objects'][0]
    assert row['fields']['count']['value']==95 and row['children'][0]['fields']['wavelength']['value']==550
    assert row['children'][0]['fields']['bad']['api_status']==30
    assert native.deleted==['children','parents'] and not native.alive
    native=Native(fail=True);session.lt=native
    try:session.read_child_fields('root','parent',['count'],'child',['wavelength'],10,100)
    except RuntimeError as exc:assert str(exc)=='child traversal failure'
    else:raise AssertionError('Traversal failure must propagate')
    assert native.deleted==['children','parents'] and not native.alive
    print('PASS nested identity, checked field failure and reverse cleanup')

if __name__=='__main__':run()
