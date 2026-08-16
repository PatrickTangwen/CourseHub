"""Canonical instructor-name records shared by the index builder and reader."""

from typing import Dict, Iterable, List, Tuple


def normalize_instructor_name(value: str) -> str:
    """Case-fold and collapse whitespace without changing token order."""
    return " ".join((value or "").strip().casefold().split())


def _explicit_name_parts(value: str) -> Tuple[str, str]:
    normalized = normalize_instructor_name(value)
    if not normalized:
        return "", ""
    if "," in normalized:
        family, given = (part.strip() for part in normalized.split(",", 1))
        return f"{given} {family}".strip(), family
    return normalized, normalized.rsplit(" ", 1)[-1]


def build_instructor_name_records(names: Iterable[str]) -> List[Dict[str, str]]:
    """Build source/full/family aliases, using comma-form names as family truth.

    Snapshots mix ``First Last`` and ``Last, First``. Comma-form records make
    compound family names explicit, and are used to annotate matching natural-
    order names when both formats occur in the corpus.
    """
    cleaned = {str(name).strip() for name in names if name and str(name).strip()}
    explicit_family_by_full: Dict[str, str] = {}
    for name in cleaned:
        if "," not in name:
            continue
        full_name, family_name = _explicit_name_parts(name)
        if full_name and family_name:
            explicit_family_by_full.setdefault(full_name, family_name)

    records = []
    for name in sorted(cleaned):
        full_name, default_family = _explicit_name_parts(name)
        records.append({
            "source_name": name,
            "source_key": normalize_instructor_name(name),
            "canonical_full": full_name,
            "family_name": explicit_family_by_full.get(full_name, default_family),
        })
    return records
