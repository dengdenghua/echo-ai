"""Bounded access to the locally installed vendor HTML documentation."""

import os
from functools import lru_cache
from html.parser import HTMLParser
from pathlib import Path


def installation() -> Path:
    configured = os.environ.get("LIGHTTOOLS_HOME")
    if configured:
        root = Path(configured).resolve()
        if not (root / "lt.exe").is_file():
            raise ValueError("LIGHTTOOLS_HOME does not contain lt.exe")
        return root
    base = Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "Optical Research Associates"
    roots = sorted((p for p in base.glob("LightTools *") if (p / "lt.exe").is_file()), reverse=True)
    if not roots:
        raise FileNotFoundError("LightTools installation not found; set LIGHTTOOLS_HOME")
    return roots[0]


class _Text(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.hidden = 0
        self.in_content = False
        self.depth = 0
        self.content_depth = 0
        self.title = []
        self.in_title = False

    def handle_starttag(self, tag, attrs):
        if tag == "title":
            self.in_title = True
        if tag in ("script", "style"):
            self.hidden += 1
        if tag == "div":
            self.depth += 1
            if dict(attrs).get("id") == "page_content":
                self.in_content = True
                self.content_depth = self.depth
        if self.in_content and tag in ("div", "br", "tr", "p", "li"):
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False
        if tag in ("script", "style"):
            self.hidden = max(0, self.hidden - 1)
        if self.in_content and tag in ("div", "tr", "p", "li"):
            self.parts.append("\n")
        if tag == "div":
            if self.depth == self.content_depth:
                self.in_content = False
            self.depth -= 1

    def handle_data(self, data):
        if self.in_title:
            self.title.append(data)
        if self.in_content and not self.hidden:
            self.parts.append(data)


def read_doc(section: str, filename: str) -> dict:
    if section not in ("api", "cmd", "dbhlp"):
        raise ValueError("section must be api, cmd, or dbhlp")
    if Path(filename).name != filename or not filename.endswith(".html"):
        raise ValueError("Provide a single .html filename from lt_docs_search")
    path = installation() / "Help" / section / filename
    parser = _Text()
    parser.feed(path.read_text(encoding="utf-8"))
    body = "\n".join(line.strip() for line in "".join(parser.parts).splitlines() if line.strip())
    return {"title": "".join(parser.title), "path": str(path), "text": body}


@lru_cache(maxsize=3)
def _index(section: str):
    if section not in ("api", "cmd", "dbhlp"):
        raise ValueError("section must be api, cmd, or dbhlp")
    import re
    from html import unescape
    result = []
    for path in (installation() / "Help" / section).glob("*.html"):
        raw = path.read_text(encoding="utf-8")
        title = re.search(r"<title>(.*?)</title>", raw, flags=re.S)
        if title:
            result.append((unescape(title.group(1)), path.name))
    return result


def search_docs(query: str, section: str, limit: int = 15):
    terms = query.casefold().split()
    if not terms:
        raise ValueError("query cannot be empty")
    hits = [(title, name) for title, name in _index(section) if all(t in title.casefold() for t in terms)]
    hits.sort(key=lambda item: (item[0].casefold() != query.casefold(), len(item[0])))
    return {"matches": [{"title": t, "filename": n, "section": section} for t, n in hits[:limit]],
            "total_matches": len(hits)}
