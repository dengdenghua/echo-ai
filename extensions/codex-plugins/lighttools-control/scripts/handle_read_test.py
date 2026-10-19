"""Regress list lifetime, ambiguous paths and vendor failures without COM mutations."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lighttools_control.bridge import APIError, Session


class FakeSession:
    read_object_fields = Session.read_object_fields

    def __init__(self, mode='normal'):
        self.mode, self.alive, self.deleted, self.next_index = mode, False, 0, 0

    def value(self, method, *args):
        if method == 'DbList':
            self.alive = True
            return 'list'
        assert self.alive, 'read after ListDelete'
        if method == 'ListSize':
            return 2
        if method == 'ListNext':
            self.next_index += 1
            return f'handle-{self.next_index}'
        if method == 'DbKeyStr':
            if self.mode == 'path_error':
                raise APIError(method, 30)
            return 'same-name-path'
        raise AssertionError(method)

    def get(self, key, field, i, j):
        assert self.alive and (i, j) == (-1, -1)
        if key == 'same-name-path' or field == 'MISSING':
            raise APIError('DbGet', 30, 'ambiguous or missing')
        if self.mode == 'nan':
            return float('nan')
        return 550 if key == 'handle-1' else 455

    def status(self, method, key):
        assert method == 'ListDelete' and key == 'list' and self.alive
        self.alive = False
        self.deleted += 1


def main():
    fake = FakeSession()
    result = fake.read_object_fields('root', 'WAVELENGTH', ['WAVELENGTH', 'MISSING'], 1, True)
    assert (result['count'], result['returned'], result['truncated']) == (2, 1, True)
    row = result['objects'][0]
    assert row['fields']['WAVELENGTH'] == {'value': 550, 'api_status': 0}
    assert row['fields']['MISSING']['api_status'] == row['path_fields']['WAVELENGTH']['api_status'] == 30
    assert 'value' not in row['fields']['MISSING'] and 'handle' not in row
    assert fake.deleted == 1
    for mode, expected in [('nan', ValueError), ('path_error', APIError)]:
        fake = FakeSession(mode)
        try:
            fake.read_object_fields('root', 'WAVELENGTH', ['WAVELENGTH'], 2)
        except expected:
            pass
        else:
            raise AssertionError('invalid vendor result accepted')
        assert fake.deleted == 1
    print(json.dumps({'status': 'PASS', 'checks': ['within-list reads', 'truncation', 'per-field API30 without zero',
          'ambiguous path comparison', 'no leaked handles', 'NaN rejected', 'ListDelete after errors']}))


if __name__ == '__main__':
    main()
