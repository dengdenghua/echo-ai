"""Build a disk index from decoded resources and exact Smali invoke operands."""
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import struct
import time
import uuid
import xml.etree.ElementTree as ET
from deep_common import atomic_json, sha256

ANDROID = '{http://schemas.android.com/apk/res/android}'
INVOKE = re.compile(r'^\s*(invoke-[\w/-]+)\s+.*?,\s*(L[^\s;]+;->[^(\s]+\([^\s]*\)[^\s,]+)')
CLASS = re.compile(r'^\.class\s+.*?(L[^\s;]+;)\s*$')
METHOD = re.compile(r'^\.method\s+(?:.*\s)?([^\s]+\([^\s]*\)[^\s]+)\s*$')


def manifest_info(path):
    tree = ET.parse(path).getroot()
    sdk = tree.find('uses-sdk')
    app = tree.find('application')
    result = {'package': tree.get('package'), 'split': tree.get('split'),
              'version_name': tree.get(ANDROID + 'versionName'),
              'version_code': tree.get(ANDROID + 'versionCode'),
              'min_sdk': sdk.get(ANDROID + 'minSdkVersion') if sdk is not None else None,
              'target_sdk': sdk.get(ANDROID + 'targetSdkVersion') if sdk is not None else None,
              'permissions': [], 'components': []}
    for node in tree:
        if node.tag.startswith('uses-permission'):
            result['permissions'].append(node.get(ANDROID + 'name'))
    if app is not None:
        result['application'] = {key.removeprefix(ANDROID): value for key, value in app.attrib.items()}
        for node in app:
            if node.tag not in ('activity', 'activity-alias', 'service', 'receiver', 'provider'):
                continue
            item = {'type': node.tag, **{key.removeprefix(ANDROID): value for key, value in node.attrib.items()},
                    'intent_filters': [], 'metadata': []}
            for child in node:
                if child.tag == 'intent-filter':
                    item['intent_filters'].append({
                        'actions': [x.get(ANDROID + 'name') for x in child.findall('action')],
                        'categories': [x.get(ANDROID + 'name') for x in child.findall('category')],
                        'data': [{key.removeprefix(ANDROID): val for key, val in x.attrib.items()}
                                 for x in child.findall('data')]})
                elif child.tag in ('meta-data', 'property'):
                    item['metadata'].append({key.removeprefix(ANDROID): val for key, val in child.attrib.items()})
            result['components'].append(item)
    return result


def elf_info(path):
    """Read ELF section symbols only; this does not disassemble native functions."""
    data = path.read_bytes()
    if len(data) < 64 or data[:4] != b'\x7fELF':
        return {'format': 'unknown', 'symbols': [], 'limitations': ['Not an ELF library']}
    bits = data[4]
    order = '<' if data[5] == 1 else '>' if data[5] == 2 else None
    if order is None or bits not in (1, 2):
        raise ValueError('Unsupported ELF encoding')
    def unpack(fmt, offset):
        size = struct.calcsize(order + fmt)
        if offset < 0 or offset + size > len(data):
            raise ValueError('ELF structure exceeds file bounds')
        return struct.unpack_from(order + fmt, data, offset)
    machine = unpack('H', 18)[0]
    if bits == 2:
        section_offset = unpack('Q', 40)[0]
        entry_size, count = unpack('HH', 58)
        section_format, symbol_format = 'IIQQQQIIQQ', 'IBBHQQ'
    else:
        section_offset = unpack('I', 32)[0]
        entry_size, count = unpack('HH', 46)
        section_format, symbol_format = 'IIIIIIIIII', 'IIIBBH'
    if entry_size < struct.calcsize(order + section_format) or count > 65535:
        raise ValueError('Invalid ELF section table')
    sections = [unpack(section_format, section_offset + index * entry_size) for index in range(count)]
    symbols = []
    for section in sections:
        # SHT_SYMTAB and SHT_DYNSYM.
        if section[1] not in (2, 11) or section[6] >= len(sections):
            continue
        strings = sections[section[6]]
        pool = data[strings[4]:strings[4] + strings[5]]
        size = section[9] or struct.calcsize(order + symbol_format)
        if size < struct.calcsize(order + symbol_format) or section[4] + section[5] > len(data):
            raise ValueError('Invalid ELF symbol table')
        for offset in range(section[4], section[4] + section[5], size):
            values = unpack(symbol_format, offset)
            if bits == 2:
                name, info, other, shndx, address, length = values
            else:
                name, address, length, info, other, shndx = values
            if not name or name >= len(pool):
                continue
            end = pool.find(b'\x00', name)
            if end < 0:
                continue
            label = pool[name:end].decode('utf-8', 'replace')
            symbols.append({'name': label, 'address': hex(address), 'size': length,
                            'imported': shndx == 0, 'binding': info >> 4, 'type': info & 15,
                            'dynamic': section[1] == 11})
    return {'format': 'ELF', 'bits': 64 if bits == 2 else 32, 'machine': machine,
            'symbols': symbols, 'limitations': ['Stripped/sectionless symbols, dynamically registered JNI and indirect calls may be absent']}


def build_index(root, artifacts, update):
    temporary = root / ('index.' + uuid.uuid4().hex + '.sqlite')
    db = sqlite3.connect(temporary)
    db.executescript('''
        PRAGMA journal_mode=OFF;
        CREATE TABLE files(path TEXT PRIMARY KEY, sha256 TEXT, bytes INTEGER, kind TEXT, artifact TEXT);
        CREATE TABLE methods(symbol TEXT, file TEXT, start_line INTEGER, end_line INTEGER, artifact TEXT);
        CREATE INDEX method_symbol ON methods(symbol);
        CREATE TABLE calls(caller TEXT, callee TEXT, file TEXT, line INTEGER, opcode TEXT, artifact TEXT);
        CREATE INDEX call_caller ON calls(caller);
        CREATE INDEX call_callee ON calls(callee);
        CREATE TABLE resources(artifact TEXT, qualifier TEXT, name TEXT, type TEXT, value TEXT, file TEXT, line INTEGER);
        CREATE INDEX resource_name ON resources(name);
    ''')
    counts = Counter()
    diagnostics = []
    manifests = []
    native = []
    java_warnings = []
    started = time.monotonic()
    try:
        for artifact in artifacts:
            identity = artifact['id']
            raw = root / 'raw' / identity
            output = root / 'native' / identity
            output.mkdir(parents=True, exist_ok=True)
            for lib in sorted(raw.glob('lib/**/*.so')):
                if lib.is_symlink() or not lib.resolve().is_relative_to(root):
                    raise ValueError('Native member escaped workspace')
                relative = lib.relative_to(root).as_posix()
                details = {'file': relative, 'sha256': sha256(lib), 'bytes': lib.stat().st_size}
                try:
                    if lib.stat().st_size > 256 * 1024 * 1024:
                        raise ValueError('Native library exceeds 256 MiB metadata-read budget')
                    info = elf_info(lib)
                    symbol_path = output / (lib.relative_to(raw).as_posix().replace('/', '__') + '.symbols.json')
                    atomic_json(symbol_path, info)
                    details.update({key: val for key, val in info.items() if key != 'symbols'})
                    details['symbol_file'] = symbol_path.relative_to(root).as_posix()
                    details['symbol_count'] = len(info['symbols'])
                    strings_path = symbol_path.with_suffix('.strings.txt')
                    # Retain byte offsets: strings are search seeds, not evidence of executed endpoints.
                    data = lib.read_bytes()
                    with strings_path.open('w', encoding='utf-8') as stream:
                        for match in re.finditer(rb'[\x20-\x7e]{6,}', data):
                            stream.write(f'{match.start():08x}\t{match[0].decode("ascii")}\n')
                    details['strings_file'] = strings_path.relative_to(root).as_posix()
                except (ValueError, OSError, struct.error) as error:
                    details['error'] = str(error)
                    diagnostics.append({'file': relative, 'error': str(error)})
                native.append(details)
            manifest = root / 'decoded' / identity / 'AndroidManifest.xml'
            if manifest.exists():
                try:
                    info = manifest_info(manifest)
                    metadata_file = manifest.parent / 'apktool.yml'
                    if metadata_file.exists():
                        # Apktool stores SDK/version fields in apktool.yml instead of its rebuilt manifest.
                        values = dict(re.findall(r'^\s*(minSdkVersion|targetSdkVersion|versionCode|versionName):\s*(.*?)\s*$',
                                                 metadata_file.read_text(encoding='utf-8'), re.MULTILINE))
                        for key, source_key in [('min_sdk', 'minSdkVersion'), ('target_sdk', 'targetSdkVersion'),
                                                ('version_code', 'versionCode'), ('version_name', 'versionName')]:
                            if not info.get(key) and source_key in values:
                                info[key] = values[source_key].strip('\'"')
                        info['metadata_file'] = metadata_file.relative_to(root).as_posix()
                    manifests.append({'artifact': identity, 'file': manifest.relative_to(root).as_posix(), **info})
                except (ET.ParseError, OSError) as error:
                    diagnostics.append({'file': str(manifest), 'error': str(error)})

        total_seen = 0
        for folder in ('raw', 'decoded', 'java', 'native'):
            parent = root / folder
            if not parent.exists():
                continue
            for path in sorted(parent.rglob('*')):
                if not path.is_file():
                    continue
                if path.is_symlink() or not path.resolve().is_relative_to(root):
                    raise ValueError('Indexed file escaped workspace')
                relative = path.relative_to(root).as_posix()
                parts = path.relative_to(root).parts
                artifact = parts[1]
                kind = 'assets' if 'assets' in parts else 'binary'
                if folder == 'java' and path.suffix == '.java':
                    kind = 'java'
                elif path.suffix == '.smali' and folder == 'decoded':
                    kind = 'smali'
                elif folder == 'native':
                    kind = 'native'
                elif folder == 'decoded' and (path.suffix == '.xml' or path.name == 'apktool.yml'):
                    kind = 'resources'
                digest = sha256(path)
                size = path.stat().st_size
                db.execute('INSERT INTO files VALUES(?,?,?,?,?)', (relative, digest, size, kind, artifact))
                counts[kind + '_files'] += 1
                total_seen += 1
                if total_seen % 1000 == 0:
                    update('indexing', {'indexed_files': total_seen, 'elapsed_seconds': round(time.monotonic() - started)})
                if kind not in ('smali', 'resources', 'java'):
                    continue
                if size > 64 * 1024 * 1024:
                    diagnostics.append({'file': relative, 'error': 'Parser skipped file over 64 MiB; file remains searchable'})
                    continue
                text = path.read_text(encoding='utf-8', errors='replace')
                lines = text.splitlines()
                if kind == 'java':
                    bad = [(number, line.strip()[:400]) for number, line in enumerate(lines, 1)
                           if any(marker in line for marker in ('JADX ERROR', 'JADX WARN', 'Method not decompiled:'))]
                    counts['java_diagnostic_markers'] += len(bad)
                    if bad:
                        java_warnings.append({'file': relative, 'markers': bad})
                if kind == 'smali':
                    owner, active, begin = None, None, None
                    for number, line in enumerate(lines, 1):
                        found = CLASS.match(line)
                        if found:
                            owner = found[1]
                        found = METHOD.match(line)
                        if found and owner:
                            active = owner + '->' + found[1]
                            begin = number
                        elif line.strip() == '.end method' and active:
                            db.execute('INSERT INTO methods VALUES(?,?,?,?,?)', (active, relative, begin, number, artifact))
                            counts['methods'] += 1
                            active = None
                        found = INVOKE.match(line)
                        if found and active:
                            db.execute('INSERT INTO calls VALUES(?,?,?,?,?,?)', (active, found[2], relative, number, found[1], artifact))
                            counts['invoke_edges'] += 1
                    if active:
                        diagnostics.append({'file': relative, 'error': 'Unclosed Smali method; incomplete definition'})
                elif kind == 'resources' and path.suffix == '.xml' and path.parent.name.startswith('values'):
                    try:
                        tree = ET.fromstring(text)
                        if tree.tag != 'resources':
                            continue
                        locations = {}
                        for number, line in enumerate(lines, 1):
                            match = re.search(r'\bname=[\'"]([^\'"]+)', line)
                            if match:
                                locations.setdefault(match[1], number)
                        for item in tree:
                            name = item.get('name')
                            if not name:
                                continue
                            value = json.dumps(item.attrib, ensure_ascii=False, sort_keys=True) if item.tag == 'public' else ''.join(item.itertext())
                            db.execute('INSERT INTO resources VALUES(?,?,?,?,?,?,?)',
                                       (artifact, path.parent.name, name, item.tag, value, relative, locations.get(name, 1)))
                            counts['resource_entries'] += 1
                            if item.tag == 'string':
                                counts['string_entries'] += 1
                    except ET.ParseError as error:
                        diagnostics.append({'file': relative, 'error': str(error)})
        db.commit()
        unresolved = db.execute('SELECT COUNT(*) FROM calls WHERE NOT EXISTS (SELECT 1 FROM methods WHERE methods.symbol=calls.callee)').fetchone()[0]
        counts['unresolved_declared_targets'] = unresolved
        counts['indexed_files'] = total_seen
        db.close()
        os.replace(temporary, root / 'index.sqlite')
        summary = {'schema': 1, 'index_id': uuid.uuid4().hex, 'index_sha256': sha256(root / 'index.sqlite'), 'created_at': time.time(),
                   'counts': dict(counts), 'manifests': manifests, 'native_libraries': native,
                   'diagnostics': diagnostics, 'java_diagnostics_file': 'java-diagnostics.json',
                   'limitations': ['Static invoke operands, not a runtime or virtual-dispatch-resolved call graph',
                                   'Reflection, invoke-custom, dynamically loaded DEX and JNI registrations may be unresolved',
                                   'Resource and native strings are candidates; they do not prove execution or feature availability']}
        atomic_json(root / 'java-diagnostics.json', java_warnings)
        atomic_json(root / 'summary.json', summary)
        return summary
    finally:
        try:
            db.close()
        finally:
            temporary.unlink(missing_ok=True)
