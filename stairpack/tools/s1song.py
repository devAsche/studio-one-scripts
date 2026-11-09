"""Minimal loader for Studio One Song/song.xml (undeclared x: prefix)."""
from lxml import etree

XNS = "urn:s1pack-x"

def load_xml(raw: bytes):
    txt = raw.decode("utf-8-sig")
    # declare the x: prefix on the root element so lxml can parse it
    head, sep, rest = txt.partition("?>")
    i = rest.index("<")
    j = rest.index(">", i)
    root_open = rest[i:j]
    if "xmlns:x" not in root_open:
        selfclose = root_open.endswith("/")
        root_open2 = (root_open[:-1] if selfclose else root_open) + f' xmlns:x="{XNS}"' + ("/" if selfclose else "")
        rest = rest[:i] + root_open2 + rest[j:]
    parser = etree.XMLParser(remove_blank_text=False, huge_tree=True)
    return etree.fromstring((rest).encode("utf-8"), parser)

def dump_xml(root) -> bytes:
    s = etree.tostring(root, encoding="unicode")
    s = s.replace(f' xmlns:x="{XNS}"', "", 1)
    return ("﻿" + '<?xml version="1.0" encoding="UTF-8"?>\r\n' + s).encode("utf-8")

def xid(el):
    return el.get(f"{{{XNS}}}id")
