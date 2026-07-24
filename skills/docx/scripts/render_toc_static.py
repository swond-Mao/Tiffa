#!/usr/bin/env python3
"""Render static TOC entries for .docx files without Win COM."""

from __future__ import annotations

import argparse
import re
import shutil
import sys
import zipfile
from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable
import xml.etree.ElementTree as ET

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": W_NS}


def w(tag: str) -> str:
    return f"{{{W_NS}}}{tag}"


def get_w_attr(elem: ET.Element | None, name: str) -> str:
    return elem.get(w(name), "") if elem is not None else ""


def set_w_attr(elem: ET.Element, name: str, value: str) -> None:
    elem.set(w(name), value)


def contains_toc_field(node: ET.Element) -> bool:
    for instr in node.iter(w("instrText")):
        if "TOC" in (instr.text or "").upper():
            return True
    for fld in node.iter(w("fldSimple")):
        if "TOC" in get_w_attr(fld, "instr").upper():
            return True
    return False


def extract_toc_instruction(node: ET.Element) -> str:
    parts: list[str] = []
    for instr in node.iter(w("instrText")):
        text = (instr.text or "").strip()
        if text:
            parts.append(text)
    for fld in node.iter(w("fldSimple")):
        text = get_w_attr(fld, "instr").strip()
        if text:
            parts.append(text)
    return " ".join(parts)


def parse_heading_range(instruction: str) -> tuple[int, int]:
    match = re.search(r'\\o\s*"(\d+)-(\d+)"', instruction)
    if not match:
        return (1, 3)
    start, end = int(match.group(1)), int(match.group(2))
    if start > end:
        raise ValueError(f"Invalid TOC level range: {start}-{end}")
    return (start, end)


def find_toc_block(body: ET.Element) -> ET.Element | None:
    for child in list(body):
        if contains_toc_field(child):
            return child
    return None


def paragraph_heading_level(paragraph: ET.Element) -> int | None:
    p_pr = paragraph.find("w:pPr", NS)
    if p_pr is None:
        return None
    p_style = p_pr.find("w:pStyle", NS)
    style_val = get_w_attr(p_style, "val").lower()
    style_match = re.search(r"heading\s*([1-9])$", style_val)
    if style_match:
        return int(style_match.group(1))
    outline = p_pr.find("w:outlineLvl", NS)
    outline_val = get_w_attr(outline, "val")
    return int(outline_val) + 1 if outline_val.isdigit() else None


def paragraph_text(paragraph: ET.Element) -> str:
    parts: list[str] = []
    for node in paragraph.iter():
        if node.tag == w("t"):
            parts.append(node.text or "")
        elif node.tag == w("tab"):
            parts.append(" ")
        elif node.tag == w("noBreakHyphen"):
            parts.append("-")
    return " ".join("".join(parts).split())


def iter_paragraphs_excluding_toc(body: ET.Element, toc_block: ET.Element) -> Iterable[ET.Element]:
    for child in list(body):
        if child is toc_block:
            continue
        if child.tag == w("p"):
            yield child
        else:
            yield from child.iter(w("p"))


def collect_bookmark_state(root: ET.Element) -> tuple[int, set[str]]:
    max_id = -1
    names: set[str] = set()
    for start in root.iter(w("bookmarkStart")):
        raw_id = get_w_attr(start, "id")
        if raw_id.isdigit():
            max_id = max(max_id, int(raw_id))
        name = get_w_attr(start, "name")
        if name:
            names.add(name)
    return (max_id + 1, names)


def first_bookmark_name(paragraph: ET.Element) -> str | None:
    for start in paragraph.iter(w("bookmarkStart")):
        name = get_w_attr(start, "name")
        if name and name != "_GoBack":
            return name
    return None


def add_bookmark(paragraph: ET.Element, bookmark_id: int, bookmark_name: str) -> None:
    start = ET.Element(w("bookmarkStart"))
    set_w_attr(start, "id", str(bookmark_id))
    set_w_attr(start, "name", bookmark_name)
    end = ET.Element(w("bookmarkEnd"))
    set_w_attr(end, "id", str(bookmark_id))
    insert_index = 1 if len(paragraph) > 0 and paragraph[0].tag == w("pPr") else 0
    paragraph.insert(insert_index, start)
    paragraph.append(end)


@dataclass(frozen=True)
class TocEntry:
    level: int
    text: str
    anchor: str


def make_toc_paragraph(entry: TocEntry) -> ET.Element:
    paragraph = ET.Element(w("p"))
    p_pr = ET.SubElement(paragraph, w("pPr"))
    p_style = ET.SubElement(p_pr, w("pStyle"))
    set_w_attr(p_style, "val", f"TOC{entry.level}")
    hyperlink = ET.SubElement(paragraph, w("hyperlink"))
    set_w_attr(hyperlink, "anchor", entry.anchor)
    set_w_attr(hyperlink, "history", "1")
    run = ET.SubElement(hyperlink, w("r"))
    r_pr = ET.SubElement(run, w("rPr"))
    r_style = ET.SubElement(r_pr, w("rStyle"))
    set_w_attr(r_style, "val", "Hyperlink")
    ET.SubElement(run, w("t")).text = entry.text
    return paragraph


def collect_toc_entries(
    root: ET.Element, body: ET.Element, toc_block: ET.Element, start_level: int, end_level: int
) -> tuple[list[TocEntry], int]:
    next_bookmark_id, used_names = collect_bookmark_state(root)
    added = 0
    entries: list[TocEntry] = []
    for paragraph in iter_paragraphs_excluding_toc(body, toc_block):
        level = paragraph_heading_level(paragraph)
        if level is None or not (start_level <= level <= end_level):
            continue
        text = paragraph_text(paragraph)
        if not text:
            continue
        anchor = first_bookmark_name(paragraph)
        if anchor is None:
            while True:
                anchor = f"toc_auto_{next_bookmark_id}"
                if anchor not in used_names:
                    break
                next_bookmark_id += 1
            add_bookmark(paragraph, next_bookmark_id, anchor)
            used_names.add(anchor)
            next_bookmark_id += 1
            added += 1
        entries.append(TocEntry(level=level, text=text, anchor=anchor))
    return (entries, added)


def replace_toc_block(body: ET.Element, toc_block: ET.Element, toc_entries: list[TocEntry]) -> None:
    toc_paragraphs = [make_toc_paragraph(entry) for entry in toc_entries]
    if toc_block.tag == w("sdt"):
        sdt_content = toc_block.find("w:sdtContent", NS)
        if sdt_content is None:
            raise ValueError("TOC block is <w:sdt> but missing <w:sdtContent>")
        keep_prefix: list[ET.Element] = []
        for child in list(sdt_content):
            if contains_toc_field(child):
                break
            keep_prefix.append(deepcopy(child))
        for child in list(sdt_content):
            sdt_content.remove(child)
        for child in keep_prefix + toc_paragraphs:
            sdt_content.append(child)
        return
    children = list(body)
    if toc_block not in children:
        raise ValueError("TOC block not found in body children")
    index = children.index(toc_block)
    body.remove(toc_block)
    for offset, paragraph in enumerate(toc_paragraphs):
        body.insert(index + offset, paragraph)


def rewrite_docx_document_xml(input_path: Path, output_path: Path, document_xml: bytes) -> None:
    temp_path = output_path.with_name(f"{output_path.name}.tmp")
    with zipfile.ZipFile(input_path, "r") as source, zipfile.ZipFile(temp_path, "w") as target:
        for info in source.infolist():
            payload = document_xml if info.filename == "word/document.xml" else source.read(info.filename)
            copied = zipfile.ZipInfo(filename=info.filename, date_time=info.date_time)
            copied.compress_type = info.compress_type
            copied.comment = info.comment
            copied.create_system = info.create_system
            copied.external_attr = info.external_attr
            copied.internal_attr = info.internal_attr
            copied.flag_bits = info.flag_bits
            target.writestr(copied, payload)
    shutil.move(str(temp_path), str(output_path))


def render_static_toc(input_path: Path, output_path: Path) -> tuple[int, int, int, int]:
    with zipfile.ZipFile(input_path, "r") as archive:
        if "word/document.xml" not in archive.namelist():
            raise ValueError("Invalid .docx: missing word/document.xml")
        document_xml = archive.read("word/document.xml")
    ET.register_namespace("w", W_NS)
    root = ET.fromstring(document_xml)
    body = root.find("w:body", NS)
    if body is None:
        raise ValueError("Invalid document.xml: missing w:body")
    toc_block = find_toc_block(body)
    if toc_block is None:
        raise ValueError("TOC field not found in document body")
    start_level, end_level = parse_heading_range(extract_toc_instruction(toc_block))
    entries, added_bookmarks = collect_toc_entries(root, body, toc_block, start_level, end_level)
    if not entries:
        raise ValueError(f"No headings found for TOC range {start_level}-{end_level}")
    replace_toc_block(body, toc_block, entries)
    updated_xml = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    rewrite_docx_document_xml(input_path, output_path, updated_xml)
    return (len(entries), added_bookmarks, start_level, end_level)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Render static TOC without Win COM; output has clickable entries and no page numbers."
    )
    parser.add_argument("input", help="Path to input .docx file")
    parser.add_argument("-o", "--output", help="Optional output path; default is in-place")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    input_path = Path(args.input).resolve()
    output_path = Path(args.output).resolve() if args.output else input_path
    if not input_path.exists():
        print(f"Error: file not found: {input_path}", file=sys.stderr)
        sys.exit(1)
    if input_path.suffix.lower() != ".docx":
        print("Error: input file must be .docx", file=sys.stderr)
        sys.exit(1)
    if not output_path.parent.exists():
        print(f"Error: output directory does not exist: {output_path.parent}", file=sys.stderr)
        sys.exit(1)
    try:
        count, bookmarks_added, start_level, end_level = render_static_toc(input_path, output_path)
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)
    print(
        "OK: static TOC rendered "
        f"(entries={count}, levels={start_level}-{end_level}, "
        f"bookmarks_added={bookmarks_added}) -> {output_path}"
    )


if __name__ == "__main__":
    main()
