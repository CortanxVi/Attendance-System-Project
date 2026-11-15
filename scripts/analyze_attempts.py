#!/usr/bin/env python3
"""Numbers-only report of a ``face_checkin_attempts`` JSON export (test mode data).

Usage: python3 scripts/analyze_attempts.py attempts.json

Input: a JSON list of rows (or an object with a ``rows``/``data`` list), as exported for
scripts/evaluate_pad_roc.py. Columns used: outcome, failure_stage, liveness_action,
similarity_score, diagnostics (the numbers-only object written by
backend/services/attempt_diagnostics.py, optionally with ``diagnostics.client``).

What it prints: outcome and failure-stage counts, pass rate per action, pass rate per client
platform/browser/delegate (when present), PAD per-frame statistics with correlations, what the
three PAD aggregation rules of evaluate_pad_roc.py would decide at the current threshold, a
68-point vs 106-point blink table (with the decision of the current two-rule blink check), identity
similarity percentiles and timing percentiles.

Privacy: counts, rates and measurements only. Row ids, user ids, tester labels, timestamps,
failure texts and app versions are never printed. It changes nothing. Standard library only.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable

SCRIPTS = Path(__file__).resolve().parent
PAD_THRESHOLD = 0.65  # old rule (LIVENESS_PAD_RULE=all_frames)
# Production rule since 2026-11-15 (LIVENESS_PAD_RULE=median); mirrors backend/core/config.py.
PAD_MEDIAN_THRESHOLD = 0.60
PAD_MIN_FRAME_FLOOR = 0.30
# Mirrors backend/services/liveness_frame_service.py (kept in sync by a backend test).
BLINK_RECOVERY_RATIO = 0.70
BLINK_106_CLOSED_RATIO_MAX = 0.50
BLINK_106_68_CEILING = 0.94
BLINK_106_MIN_OPEN_BASE = 0.10
BLINK_106_RECOVERY_RATIO = 0.70


def _load_pad_rules():
    """Reuse the three aggregation rules of evaluate_pad_roc.py (loaded by path, not sys.path)."""

    spec = importlib.util.spec_from_file_location("evaluate_pad_roc", SCRIPTS / "evaluate_pad_roc.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules.setdefault("evaluate_pad_roc", module)  # dataclasses need the module registered
    spec.loader.exec_module(module)
    return module


def normalise_rows(data: Any) -> list[dict[str, Any]]:
    """Rows as dicts with ``diagnostics`` parsed to a dict (or None)."""

    if isinstance(data, dict):
        data = data.get("rows") or data.get("data") or []
    if not isinstance(data, list):
        raise ValueError("attempts file must hold a JSON list of rows")
    rows = []
    for row in data:
        if not isinstance(row, dict):
            continue
        diagnostics = row.get("diagnostics")
        if isinstance(diagnostics, str):
            try:
                diagnostics = json.loads(diagnostics)
            except json.JSONDecodeError:
                diagnostics = None
        rows.append(dict(row, diagnostics=diagnostics if isinstance(diagnostics, dict) else None))
    return rows


def load_rows(path: Path) -> list[dict[str, Any]]:
    return normalise_rows(json.loads(path.read_text(encoding="utf-8")))


def num(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    value = float(value)
    return value if math.isfinite(value) else None


def get(mapping: Any, *path: str) -> Any:
    for key in path:
        if not isinstance(mapping, dict):
            return None
        mapping = mapping.get(key)
    return mapping


def percentile(values: list[float], q: float) -> float:
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    position = (len(ordered) - 1) * q
    low = math.floor(position)
    high = min(low + 1, len(ordered) - 1)
    return ordered[low] + (ordered[high] - ordered[low]) * (position - low)


def pct_line(name: str, values: Iterable[float | None], digits: int = 3) -> str:
    clean = [v for v in values if v is not None]
    if not clean:
        return f"  {name:<28} n=0"
    fmt = f"{{:.{digits}f}}"
    parts = " ".join(f"p{int(q * 100)}={fmt.format(percentile(clean, q))}" for q in (0.0, 0.1, 0.5, 0.9, 1.0))
    return f"  {name:<28} n={len(clean):<3} {parts}"


def pearson(xs: list[float], ys: list[float]) -> float | None:
    if len(xs) < 3:
        return None
    mx, my = statistics.fmean(xs), statistics.fmean(ys)
    sx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    sy = math.sqrt(sum((y - my) ** 2 for y in ys))
    if sx == 0 or sy == 0:
        return None
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / (sx * sy)


def spearman(xs: list[float], ys: list[float]) -> float | None:
    def ranks(values: list[float]) -> list[float]:
        order = sorted(range(len(values)), key=lambda i: values[i])
        result = [0.0] * len(values)
        i = 0
        while i < len(order):
            j = i
            while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
                j += 1
            for k in range(i, j + 1):
                result[order[k]] = (i + j) / 2
            i = j + 1
        return result

    return pearson(ranks(xs), ranks(ys)) if len(xs) >= 3 else None


def rate(passed: int, total: int) -> str:
    return f"{passed}/{total} ({passed / total:.0%})" if total else "0/0"


def section(title: str) -> list[str]:
    return ["", f"== {title} =="]


def report_counts(rows: list[dict[str, Any]], diag_rows: list[dict[str, Any]]) -> list[str]:
    lines = [f"rows {len(rows)}, with diagnostics {len(diag_rows)}"]
    for label, subset in (("all rows", rows), ("rows with diagnostics", diag_rows)):
        lines += section(f"outcome / failure_stage ({label})")
        for outcome, count in sorted(Counter(r.get("outcome") or "none" for r in subset).items()):
            lines.append(f"  outcome {outcome:<20} {count}")
        stages = Counter(r.get("failure_stage") or "none" for r in subset if r.get("outcome") != "success")
        for stage, count in stages.most_common():
            lines.append(f"  stage   {stage:<20} {count}")
        lines += section(f"pass rate per action ({label})")
        by_action: dict[str, list[bool]] = defaultdict(list)
        for r in subset:
            by_action[str(r.get("liveness_action") or "none")].append(r.get("outcome") == "success")
        for action, results in sorted(by_action.items()):
            lines.append(f"  {action:<14} {rate(sum(results), len(results))}")
    return lines


def report_client(diag_rows: list[dict[str, Any]]) -> list[str]:
    lines = section("per client (diagnostics.client)")
    with_client = [r for r in diag_rows if isinstance(get(r, "diagnostics", "client"), dict)]
    if not with_client:
        return lines + ["  no rows carry diagnostics.client yet"]
    for key in ("platform", "browser", "delegate"):
        groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for r in with_client:
            groups[str(get(r, "diagnostics", "client", key) or "missing")].append(r)
        for value, members in sorted(groups.items()):
            passed = sum(1 for m in members if m.get("outcome") == "success")
            stages = Counter(m.get("failure_stage") or "none" for m in members if m.get("outcome") != "success")
            stage_text = ", ".join(f"{s} {c}" for s, c in stages.most_common()) or "-"
            lines.append(f"  {key:<9} {value:<9} pass {rate(passed, len(members)):<14} fails: {stage_text}")
    for key in ("analysis_fps", "camera_w", "camera_h", "luma", "sharpness", "frame_errors", "warmup_ms"):
        lines.append(pct_line(f"client.{key}", (num(get(r, "diagnostics", "client", key)) for r in with_client), 1))
    return lines


def _passive_pitch(diagnostics: dict[str, Any]) -> float | None:
    values = [num(p.get("pitch")) for p in diagnostics.get("pose") or [] if isinstance(p, dict) and p.get("frame") in ("f2", "f3")]
    values = [abs(v) for v in values if v is not None]
    return max(values) if values else None


def report_pad(diag_rows: list[dict[str, Any]], pad_rules) -> list[str]:
    lines = section("PAD per frame (diagnostics.pad.live)")
    samples = []
    for r in diag_rows:
        live = pad_rules.pad_scores(r)
        if live is not None:
            samples.append((r, live))
    if not samples:
        return lines + ["  no rows with 3 per-frame PAD scores"]
    failed = [(r, live) for r, live in samples if min(live) < PAD_THRESHOLD]
    lines.append(f"  rows with PAD scores {len(samples)}, below {PAD_THRESHOLD} on min {len(failed)}")
    for index in range(3):
        lines.append(pct_line(f"frame {index + 1} live", (live[index] for _r, live in samples)))
    for label, subset in (("all", samples), ("pad-failed", failed)):
        lowest = Counter(min(range(3), key=lambda i: live[i]) + 1 for _r, live in subset)
        lines.append(f"  lowest frame index ({label}): " + ", ".join(f"f{k} {lowest.get(k, 0)}" for k in (1, 2, 3)))
    lines.append("  pad-failed rows (frames below threshold, spread max-min, ref width, fps):")
    for _r, live in failed:
        below = sum(1 for p in live if p < PAD_THRESHOLD)
        diagnostics = _r["diagnostics"]
        width = num(get(diagnostics, "reference", "width"))
        fps = num(get(diagnostics, "timing", "fps"))
        lines.append(
            "    " + "/".join(f"{p:.2f}" for p in live)
            + f"  below {below}/3  spread {max(live) - min(live):.2f}"
            + f"  width {width if width is not None else float('nan'):.2f}  fps {fps if fps is not None else float('nan'):.1f}"
        )
    single = sum(1 for _r, live in failed if sum(1 for p in live if p < PAD_THRESHOLD) == 1)
    lines.append(f"  pad-failed rows with exactly one frame below {PAD_THRESHOLD}: {single}/{len(failed)}")
    lines.append(f"  pad-failed rows with another frame >= {PAD_THRESHOLD}: "
                 f"{sum(1 for _r, live in failed if max(live) >= PAD_THRESHOLD)}/{len(failed)}")

    lines += section("PAD min vs capture conditions (Pearson r / Spearman rho, n)")
    features = {
        "timing.fps": lambda d: num(get(d, "timing", "fps")),
        "reference.width": lambda d: num(get(d, "reference", "width")),
        "reference.det": lambda d: num(get(d, "reference", "det")),
        "max |pitch| f2/f3 vs f1": _passive_pitch,
        "reference.center": lambda d: num(get(d, "reference", "center")),
    }
    for name, read in features.items():
        pairs = [(read(r["diagnostics"]), min(live)) for r, live in samples]
        pairs = [(x, y) for x, y in pairs if x is not None]
        xs, ys = [x for x, _ in pairs], [y for _, y in pairs]
        r_p, r_s = pearson(xs, ys), spearman(xs, ys)
        show = lambda v: "n/a" if v is None else f"{v:+.2f}"
        lines.append(f"  {name:<26} r={show(r_p):<6} rho={show(r_s):<6} n={len(pairs)}")
    groups: dict[str, list[tuple[float, ...]]] = defaultdict(list)
    for r, live in samples:
        width = num(get(r["diagnostics"], "reference", "width"))
        groups["width<0.35" if width is not None and width < 0.35 else "width>=0.35" if width is not None else "width?"].append(live)
    for name, members in sorted(groups.items()):
        fails = sum(1 for live in members if min(live) < PAD_THRESHOLD)
        lines.append(f"  group {name:<12} pad-failed {rate(fails, len(members))}")

    lines += section(f"PAD aggregation rules at t={PAD_THRESHOLD} on these rows (all treated as genuine)")
    floor = pad_rules.DEFAULT_FLOOR
    for key, (title, rule) in pad_rules.RULES.items():
        refused = sum(1 for _r, live in samples if rule(live, floor) < PAD_THRESHOLD)
        lines.append(f"  [{key:<9}] {title:<44} refused {rate(refused, len(samples))}")
    refused_now = sum(
        1 for _r, live in samples
        if not (statistics.median(live) >= PAD_MEDIAN_THRESHOLD and min(live) >= PAD_MIN_FRAME_FLOOR)
    )
    lines.append(
        f"  [production] median >= {PAD_MEDIAN_THRESHOLD:.2f} and min >= {PAD_MIN_FRAME_FLOOR:.2f}"
        f"{'':<17} refused {rate(refused_now, len(samples))}"
    )
    lines.append("  NOTE: no consented attack rows here, so FAR is unknown for every rule.")
    return lines


def _blink_rule(b: dict[str, Any]) -> str:
    values = {k: num(b.get(k)) for k in (
        "closed_left", "closed_right", "limit_left", "limit_right", "back_left", "back_right",
        "closed_left_106", "closed_right_106", "back_left_106", "back_right_106",
        "open_left_106", "open_right_106")}
    if None in (values["closed_left"], values["closed_right"], values["back_left"], values["back_right"]):
        return "?"
    limit_l = values["limit_left"] or 0.78
    limit_r = values["limit_right"] or 0.78
    back68 = values["back_left"] >= BLINK_RECOVERY_RATIO and values["back_right"] >= BLINK_RECOVERY_RATIO
    if values["closed_left"] <= limit_l and values["closed_right"] <= limit_r and back68:
        return "68"
    v106 = [values[k] for k in ("closed_left_106", "closed_right_106", "back_left_106", "back_right_106")]
    if None in v106:
        return "none(no106)"
    bases = (values["open_left_106"], values["open_right_106"])
    if None in bases or min(bases) < BLINK_106_MIN_OPEN_BASE:
        return "none(base106)"
    if (
        max(v106[0], v106[1]) <= BLINK_106_CLOSED_RATIO_MAX
        and max(values["closed_left"], values["closed_right"]) <= BLINK_106_68_CEILING
        and min(v106[2], v106[3]) >= BLINK_106_RECOVERY_RATIO
        and back68
    ):
        return "106"
    return "none"


def report_blink(diag_rows: list[dict[str, Any]]) -> list[str]:
    lines = section("blink 68-point vs 106-point (ratios to the open-eye baseline)")
    blink_rows = [r for r in diag_rows if isinstance(get(r, "diagnostics", "blink"), dict)]
    if not blink_rows:
        return lines + ["  no rows with diagnostics.blink"]
    lines.append("  #  outcome  stage        68 closed L/R  limit L/R    68 back L/R  106 closed L/R  106 back L/R  "
                 "recorded rule  rule now")
    fmt = lambda v: "  -  " if v is None else f"{v:.2f}"
    for index, r in enumerate(blink_rows, start=1):
        b = r["diagnostics"]["blink"]
        g = lambda k: num(b.get(k))
        lines.append(
            f"  {index:<2} {str(r.get('outcome')):<8} {str(r.get('failure_stage') or '-'):<12} "
            f"{fmt(g('closed_left'))}/{fmt(g('closed_right'))}    {fmt(g('limit_left'))}/{fmt(g('limit_right'))}  "
            f"{fmt(g('back_left'))}/{fmt(g('back_right'))}    {fmt(g('closed_left_106'))}/{fmt(g('closed_right_106'))}"
            f"       {fmt(g('back_left_106'))}/{fmt(g('back_right_106'))}     {str(b.get('blink_rule') or '-'):<14} {_blink_rule(b)}"
        )
    decided = Counter(_blink_rule(r["diagnostics"]["blink"]) for r in blink_rows if r.get("failure_stage") in (None, "blink"))
    lines.append("  rule now on rows that reached the blink decision: " + ", ".join(f"{k} {v}" for k, v in sorted(decided.items())))
    return lines


def report_similarity_and_timing(rows: list[dict[str, Any]], diag_rows: list[dict[str, Any]]) -> list[str]:
    lines = section("identity similarity")
    lines.append(pct_line("similarity (success rows)", (num(r.get("similarity_score")) for r in rows if r.get("outcome") == "success")))
    lines.append(pct_line("similarity (failed rows)", (num(r.get("similarity_score")) for r in rows if r.get("outcome") != "success")))
    lines.append(pct_line("min frame_similarity", (
        min(v for v in (num(x) for x in get(r, "diagnostics", "frame_similarity") or []) if v is not None)
        if any(num(x) is not None for x in get(r, "diagnostics", "frame_similarity") or []) else None
        for r in diag_rows
    )))
    lines += section("timing (diagnostics.timing)")
    keys = sorted({k for r in diag_rows for k, v in (get(r, "diagnostics", "timing") or {}).items() if num(v) is not None})
    for key in keys:
        lines.append(pct_line(key, (num(get(r, "diagnostics", "timing", key)) for r in diag_rows), 1))
    return lines


def build_report(rows: list[dict[str, Any]]) -> str:
    pad_rules = _load_pad_rules()
    rows = normalise_rows(rows)
    diag_rows = [r for r in rows if r.get("diagnostics")]
    lines = ["face_checkin_attempts report (numbers only)"]
    lines += report_counts(rows, diag_rows)
    lines += report_client(diag_rows)
    lines += report_pad(diag_rows, pad_rules)
    lines += report_blink(diag_rows)
    lines += report_similarity_and_timing(rows, diag_rows)
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("attempts", type=Path, help="JSON export of face_checkin_attempts")
    args = parser.parse_args(argv)
    try:
        rows = load_rows(args.attempts)
    except (OSError, ValueError) as exc:
        print(f"cannot read attempts: {exc.__class__.__name__}", file=sys.stderr)
        return 2
    sys.stdout.write(build_report(rows))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
