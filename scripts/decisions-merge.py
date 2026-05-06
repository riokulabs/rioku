#!/usr/bin/env python3
"""decisions-merge.py — merge per-worktree decision entries into the master list.

Usage: decisions-merge.py <master_in> <new_entries> <master_out>

The merge logic:
- Parse <master_in> into ## Open and ## Resolved sections.
- Parse <new_entries> as a list of ## Item NNN — slug blocks.
- For each new entry, dedup against existing entries by Item ID.
- Append new entries (not already present) to ## Open.
- Preserve ## Resolved verbatim.
- Write the result to <master_out>.

The implementation is intentionally simple: text-only, no Markdown AST.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path


ITEM_HEADER_RE = re.compile(r'^## Item (\d+)\b')


def split_master(text: str) -> tuple[str, dict[str, str], dict[str, str], str]:
    """Return (preamble_through_open_heading, open_items_by_id, resolved_items_by_id, footer_after_resolved)."""
    lines = text.splitlines(keepends=True)
    open_idx = next((i for i, l in enumerate(lines) if l.strip() == '## Open'), -1)
    res_idx = next((i for i, l in enumerate(lines) if l.strip() == '## Resolved'), -1)
    if open_idx == -1 or res_idx == -1 or res_idx <= open_idx:
        raise ValueError('master file missing ## Open and ## Resolved section headers')

    preamble = ''.join(lines[: open_idx + 1])  # everything through and including '## Open'
    open_block = ''.join(lines[open_idx + 1 : res_idx])
    resolved_and_after = ''.join(lines[res_idx :])  # '## Resolved\n…' kept intact

    return preamble, parse_items(open_block), parse_items(resolved_and_after.split('## Resolved', 1)[1]), resolved_and_after


def parse_items(text: str) -> dict[str, str]:
    """Split a section's body into {item_id: full_block_text}."""
    items: dict[str, str] = {}
    cur_id: str | None = None
    cur: list[str] = []
    for line in text.splitlines(keepends=True):
        m = ITEM_HEADER_RE.match(line)
        if m:
            if cur_id is not None:
                items[cur_id] = ''.join(cur)
            cur_id = m.group(1)
            cur = [line]
        elif cur_id is not None:
            cur.append(line)
    if cur_id is not None:
        items[cur_id] = ''.join(cur)
    return items


def main() -> int:
    if len(sys.argv) != 4:
        print(__doc__, file=sys.stderr)
        return 2

    master_in = Path(sys.argv[1]).read_text(encoding='utf-8')
    new_entries = Path(sys.argv[2]).read_text(encoding='utf-8')
    master_out = Path(sys.argv[3])

    preamble, open_items, resolved_items, resolved_block = split_master(master_in)
    incoming = parse_items(new_entries)

    # Append new (not in either section) entries to open
    for item_id, block in sorted(incoming.items(), key=lambda kv: int(kv[0])):
        if item_id in open_items or item_id in resolved_items:
            continue
        open_items[item_id] = block

    # Reassemble
    merged_open = '\n' + ''.join(
        open_items[i] for i in sorted(open_items.keys(), key=int)
    ) if open_items else '\n(none)\n\n'

    out_text = preamble + merged_open + ('\n' if not resolved_block.startswith('\n') else '') + resolved_block

    master_out.write_text(out_text, encoding='utf-8')
    print(f'merged: open={len(open_items)} resolved={len(resolved_items)} new={len(incoming)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
