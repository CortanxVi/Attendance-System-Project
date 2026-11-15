#!/usr/bin/env python3
"""Offline ROC study of the passive PAD score from the test-only attempt log.

Input
-----
* ``attempts``: a JSON export of ``public.face_checkin_attempts`` (a list of rows, or an object
  with a ``rows``/``data`` list). Each row needs ``created_at`` and ``diagnostics``; rows whose
  ``diagnostics.pad.live`` does not hold 3 numbers (PAD never ran) are skipped and counted.
* ``labels``: a CSV with header ``start_iso,end_iso,label``. ``label`` is one of
  attack_print | attack_screen | attack_video | genuine. Each line marks a consented attack
  session (start inclusive, end exclusive). Rows outside every attack window are genuine; a
  ``genuine`` window is accepted for clarity but changes nothing.

What it computes, for three ways of turning the 3 per-frame live probabilities into a decision:
  (a) min      : min(p1, p2, p3) >= t                       (the old rule, LIVENESS_PAD_RULE=all_frames)
  (b) median   : median(p) >= t and min(p) >= floor          (floor default 0.30; the production
                 rule since 2026-11-15 at t = 0.60, LIVENESS_PAD_RULE=median)
  (c) meanlogit: mean(logit(p)) >= logit(t)
* ROC points (threshold, FRR, FAR) over a threshold grid,
* FRR (genuine refused) and FAR (attack accepted) at the current threshold 0.65,
* the threshold with the lowest FRR whose FAR <= target (default 1%).

It never changes anything. When genuine n < 200 or attack n < 100 it prints a clear refusal to
recommend a change (TuningModelLog.md plan requirement), but still prints the numbers.

Privacy: the output holds counts, rates and thresholds only — no row ids, student ids, names,
e-mails or timestamps. Python standard library only.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import statistics
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable

CURRENT_THRESHOLD = 0.65  # old all_frames rule; the production median rule uses 0.60 (see --help text)
DEFAULT_FLOOR = 0.30
DEFAULT_FAR_TARGET = 0.01
MIN_GENUINE = 200
MIN_ATTACK = 100
ATTACK_LABELS = ("attack_print", "attack_screen", "attack_video")
VALID_LABELS = ATTACK_LABELS + ("genuine",)
_EPS = 1e-6


@dataclass(frozen=True)
class Window:
    start: datetime
    end: datetime
    label: str


@dataclass(frozen=True)
class Sample:
    label: str             # "genuine" or one of ATTACK_LABELS
    live: tuple[float, float, float]

    @property
    def is_attack(self) -> bool:
        return self.label in ATTACK_LABELS


def parse_time(value: str) -> datetime:
    text = str(value).strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    parsed = datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def load_labels(path: Path) -> list[Window]:
    windows: list[Window] = []
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        missing = {"start_iso", "end_iso", "label"} - set(reader.fieldnames or ())
        if missing:
            raise ValueError(f"labels file is missing columns: {', '.join(sorted(missing))}")
        for line, row in enumerate(reader, start=2):
            label = (row.get("label") or "").strip()
            if label not in VALID_LABELS:
                raise ValueError(f"labels line {line}: unknown label (allowed: {', '.join(VALID_LABELS)})")
            start, end = parse_time(row["start_iso"]), parse_time(row["end_iso"])
            if end <= start:
                raise ValueError(f"labels line {line}: end must be after start")
            windows.append(Window(start, end, label))
    return windows


def load_attempts(path: Path) -> list[dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict):
        data = data.get("rows") or data.get("data") or []
    if not isinstance(data, list):
        raise ValueError("attempts file must hold a JSON list of rows")
    return [row for row in data if isinstance(row, dict)]


def pad_scores(row: dict[str, Any]) -> tuple[float, float, float] | None:
    diagnostics = row.get("diagnostics")
    if isinstance(diagnostics, str):
        try:
            diagnostics = json.loads(diagnostics)
        except json.JSONDecodeError:
            return None
    if not isinstance(diagnostics, dict):
        return None
    pad = diagnostics.get("pad")
    live = pad.get("live") if isinstance(pad, dict) else None
    if not isinstance(live, list) or len(live) != 3:
        return None
    values: list[float] = []
    for value in live:
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            return None
        values.append(min(max(float(value), 0.0), 1.0))
    return (values[0], values[1], values[2])


def label_for(created_at: datetime, windows: Iterable[Window]) -> str:
    for window in windows:
        if window.label in ATTACK_LABELS and window.start <= created_at < window.end:
            return window.label
    return "genuine"


def build_samples(rows: list[dict[str, Any]], windows: list[Window]) -> tuple[list[Sample], int]:
    samples: list[Sample] = []
    skipped = 0
    for row in rows:
        live = pad_scores(row)
        created = row.get("created_at")
        if live is None or not created:
            skipped += 1
            continue
        try:
            when = parse_time(str(created))
        except ValueError:
            skipped += 1
            continue
        samples.append(Sample(label_for(when, windows), live))
    return samples, skipped


def logit(probability: float) -> float:
    p = min(max(probability, _EPS), 1 - _EPS)
    return math.log(p / (1 - p))


def sigmoid(value: float) -> float:
    return 1.0 / (1.0 + math.exp(-value))


# Each rule maps the 3 probabilities to one score s, accepted as live iff s >= t. This makes
# every rule monotone in t, so FRR rises and FAR falls as t grows.
def score_min(live: tuple[float, ...], floor: float) -> float:
    return min(live)


def score_median(live: tuple[float, ...], floor: float) -> float:
    return statistics.median(live) if min(live) >= floor else -math.inf


def score_mean_logit(live: tuple[float, ...], floor: float) -> float:
    # mean(logit p) >= logit(t)  <=>  sigmoid(mean(logit p)) >= t
    return sigmoid(sum(logit(p) for p in live) / len(live))


RULES: dict[str, tuple[str, Callable[[tuple[float, ...], float], float]]] = {
    "min": ("(a) min of 3 frames >= t (old rule)", score_min),
    "median": ("(b) median >= t and min >= floor (production at t=0.60)", score_median),
    "meanlogit": ("(c) mean of logits >= logit(t)", score_mean_logit),
}


def rates(genuine: list[float], attack: list[float], threshold: float) -> tuple[float | None, float | None]:
    frr = sum(1 for s in genuine if s < threshold) / len(genuine) if genuine else None
    far = sum(1 for s in attack if s >= threshold) / len(attack) if attack else None
    return frr, far


def threshold_grid(step: float) -> list[float]:
    count = int(round(1.0 / step))
    grid = {round(i * step, 6) for i in range(count + 1)}
    grid.add(CURRENT_THRESHOLD)
    return sorted(grid)


def evaluate(
    samples: list[Sample],
    *,
    floor: float = DEFAULT_FLOOR,
    far_target: float = DEFAULT_FAR_TARGET,
    step: float = 0.01,
    current: float = CURRENT_THRESHOLD,
) -> dict[str, Any]:
    genuine_live = [s.live for s in samples if not s.is_attack]
    attack_live = [s.live for s in samples if s.is_attack]
    by_label = {label: sum(1 for s in samples if s.label == label) for label in ATTACK_LABELS}
    grid = threshold_grid(step)
    result: dict[str, Any] = {
        "n_genuine": len(genuine_live),
        "n_attack": len(attack_live),
        "n_attack_by_label": by_label,
        "current_threshold": current,
        "floor": floor,
        "far_target": far_target,
        "enough_data": len(genuine_live) >= MIN_GENUINE and len(attack_live) >= MIN_ATTACK,
        "rules": {},
    }
    for key, (title, rule) in RULES.items():
        genuine = [rule(live, floor) for live in genuine_live]
        attack = [rule(live, floor) for live in attack_live]
        roc = []
        for t in grid:
            frr, far = rates(genuine, attack, t)
            roc.append({"t": t, "frr": frr, "far": far})
        frr_now, far_now = rates(genuine, attack, current)
        best = None
        if attack and genuine:
            allowed = [point for point in roc if point["far"] is not None and point["far"] <= far_target]
            if allowed:
                # Lowest FRR; on a tie prefer the HIGHER (stricter) threshold.
                best = min(allowed, key=lambda point: (point["frr"], -point["t"]))
        result["rules"][key] = {
            "title": title,
            "at_current": {"t": current, "frr": frr_now, "far": far_now},
            "best_under_far_target": best,
            "roc": roc,
        }
    return result


def _pct(value: float | None) -> str:
    return "n/a" if value is None else f"{value * 100:6.2f}%"


def format_report(result: dict[str, Any], *, skipped: int = 0, roc_every: float = 0.05) -> str:
    lines = [
        "PAD ROC study (offline, numbers only)",
        f"genuine attempts: {result['n_genuine']}   attack attempts: {result['n_attack']} "
        + "(" + ", ".join(f"{k} {v}" for k, v in result["n_attack_by_label"].items()) + ")",
        f"rows skipped (no 3 PAD scores): {skipped}",
        f"current threshold {result['current_threshold']:.2f}, median-rule floor {result['floor']:.2f}, "
        f"FAR target {result['far_target'] * 100:.2f}%",
        "",
    ]
    if not result["enough_data"]:
        lines += [
            "*** NO RECOMMENDATION: not enough data. ***",
            f"The plan requires at least {MIN_GENUINE} genuine and {MIN_ATTACK} attack attempts "
            f"(have {result['n_genuine']} and {result['n_attack']}).",
            "Do not change LIVENESS_PAD_THRESHOLD or the aggregation rule from these numbers.",
            "",
        ]
    for key, rule in result["rules"].items():
        now = rule["at_current"]
        best = rule["best_under_far_target"]
        lines.append(f"[{key}] {rule['title']}")
        lines.append(f"  at t={now['t']:.2f}: FRR {_pct(now['frr'])}  FAR {_pct(now['far'])}")
        if best is None:
            lines.append(f"  lowest-FRR t with FAR <= {result['far_target'] * 100:.2f}%: n/a "
                         "(no attack data or no threshold meets the target)")
        else:
            lines.append(f"  lowest-FRR t with FAR <= {result['far_target'] * 100:.2f}%: t={best['t']:.2f} "
                         f"FRR {_pct(best['frr'])} FAR {_pct(best['far'])}")
        lines.append("  ROC   t     FRR       FAR")
        for point in rule["roc"]:
            t = point["t"]
            on_grid = abs(t / roc_every - round(t / roc_every)) < 1e-6
            if on_grid or abs(t - result["current_threshold"]) < 1e-9:
                lines.append(f"      {t:4.2f}  {_pct(point['frr'])}  {_pct(point['far'])}")
        lines.append("")
    if result["enough_data"]:
        lines.append("Enough data for a study. Any change still needs review in TuningModelLog.md; "
                     "this script only reports.")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n", 1)[0])
    parser.add_argument("attempts", type=Path, help="JSON export of face_checkin_attempts")
    parser.add_argument("labels", type=Path, help="CSV start_iso,end_iso,label of attack sessions")
    parser.add_argument("--floor", type=float, default=DEFAULT_FLOOR, help="min-frame floor for rule (b)")
    parser.add_argument("--far-target", type=float, default=DEFAULT_FAR_TARGET, help="e.g. 0.01 for 1%%")
    parser.add_argument("--step", type=float, default=0.01, help="threshold grid step")
    parser.add_argument("--json", action="store_true", help="print the full result as JSON")
    args = parser.parse_args(argv)
    if not 0 < args.step <= 0.5 or not 0 <= args.far_target <= 1 or not 0 <= args.floor <= 1:
        parser.error("step must be in (0, 0.5], far-target and floor in [0, 1]")

    samples, skipped = build_samples(load_attempts(args.attempts), load_labels(args.labels))
    result = evaluate(samples, floor=args.floor, far_target=args.far_target, step=args.step)
    if args.json:
        print(json.dumps({**result, "skipped": skipped}, indent=2))
        if not result["enough_data"]:
            print("NO RECOMMENDATION: not enough data (need >= "
                  f"{MIN_GENUINE} genuine and >= {MIN_ATTACK} attack attempts).", file=sys.stderr)
    else:
        print(format_report(result, skipped=skipped))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
