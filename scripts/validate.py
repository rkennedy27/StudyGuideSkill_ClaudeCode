"""
Validates :::question blocks in synthesized chapter files.

Checks each block for:
  - Parseable attributes (id, type, source)
  - Presence of **Q:** marker
  - For mc: at least one - [x] correct option and at least one - [ ] wrong option
  - Presence of **Answer:** marker
  - Proper ::: closing line

Usage:
    python validate.py <chapters_dir>

Exit code 0 = all blocks valid.
Exit code 1 = one or more blocks failed — chapter files are listed so the
              synthesis agent can be re-run for just those chapters.
"""

import re
import sys
from pathlib import Path

BLOCK_RE = re.compile(r":::question([{\s][^\n]*)\n([\s\S]*?)\n:::", re.MULTILINE)
ATTR_RE = re.compile(r'(\w+)=["\']?([^"\'\\s}]+)["\']?')


def parse_attrs(attr_line: str) -> dict:
    stripped = attr_line.strip().lstrip("{").rstrip("}")
    return {m[1]: m[2] for m in ATTR_RE.finditer(stripped)}


def validate_block(attrs: dict, content: str, block_num: int, filepath: str) -> list[str]:
    errors = []

    q_id = attrs.get("id", "")
    q_type = attrs.get("type", "")
    q_source = attrs.get("source", "")

    if not q_id:
        errors.append("missing id attribute")
    if q_type not in ("mc", "short", "fill"):
        errors.append(f"invalid type '{q_type}' (must be mc, short, or fill)")
    if q_source not in ("practice-quiz", "predicted", "generated"):
        errors.append(f"invalid source '{q_source}' (must be practice-quiz, predicted, or generated)")

    has_q_marker = bool(re.search(r"^\*\*Q:\*\*", content, re.MULTILINE))
    if not has_q_marker:
        errors.append("missing **Q:** marker")

    has_answer = bool(re.search(r"^\*\*Answer:\*\*", content, re.MULTILINE))
    if not has_answer:
        errors.append("missing **Answer:** marker")

    if q_type == "mc":
        correct_opts = re.findall(r"^- \[x\]", content, re.MULTILINE | re.IGNORECASE)
        wrong_opts = re.findall(r"^- \[ \]", content, re.MULTILINE)
        if len(correct_opts) != 1:
            errors.append(f"mc question must have exactly one - [x] correct option (found {len(correct_opts)})")
        if len(wrong_opts) < 1:
            errors.append("mc question must have at least one - [ ] wrong option")

    return errors


def validate_file(path: Path) -> list[tuple[int, list[str]]]:
    text = path.read_text(encoding="utf-8")
    failures = []
    for i, match in enumerate(BLOCK_RE.finditer(text), start=1):
        attrs = parse_attrs(match.group(1))
        content = match.group(2)
        errors = validate_block(attrs, content, i, str(path))
        if errors:
            failures.append((i, errors))
    return failures


def main():
    if len(sys.argv) < 2:
        print("Usage: python validate.py <chapters_dir>", file=sys.stderr)
        sys.exit(2)

    chapters_dir = Path(sys.argv[1])
    md_files = sorted(chapters_dir.glob("*.md"))

    if not md_files:
        print(f"No .md files found in {chapters_dir}")
        sys.exit(0)

    any_failed = False
    total_blocks = 0
    total_errors = 0

    for path in md_files:
        text = path.read_text(encoding="utf-8")
        block_count = len(BLOCK_RE.findall(text))
        total_blocks += block_count
        failures = validate_file(path)

        if failures:
            any_failed = True
            print(f"\nFAIL  {path.name}  ({block_count} blocks, {len(failures)} invalid)")
            for block_num, errors in failures:
                total_errors += len(errors)
                for err in errors:
                    print(f"  block {block_num}: {err}")
        else:
            print(f"OK    {path.name}  ({block_count} blocks)")

    print(f"\n{total_blocks} blocks checked across {len(md_files)} files — {total_errors} errors")

    if any_failed:
        print("\nRe-run the synthesis agent for each FAIL file listed above.")
        sys.exit(1)


if __name__ == "__main__":
    main()
