"""Measure the real buffalo_s + MiniFASNet pipeline against a synthetic hair fringe.

Run from the backend folder with the backend virtualenv:
    OUT_DIR=/tmp/face-robustness .venv/bin/python ../scripts/evaluate_forehead_occlusion.py

Uses only public sample photos shipped with insightface / scikit-image (no student images).
The fringe is a dark polygon hanging from the hairline; `coverage` is the fraction of the
forehead zone (bbox top -> brow line) it covers. 1.0 = down to the brow line, >1.0 = over the brows/eyes.
"""
import json
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.getcwd())
os.environ.setdefault("INSIGHTFACE_MODEL_ROOT", os.path.expanduser("~/.insightface"))

from services.insightface_service import face_service  # noqa: E402
from services.passive_pad_service import passive_pad_service, _crop_face  # noqa: E402
import insightface  # noqa: E402

IMG_DIR = os.path.join(os.path.dirname(insightface.__file__), "data", "images")


def load_samples():
    from skimage import data

    samples = {}
    astro = cv2.cvtColor(data.astronaut(), cv2.COLOR_RGB2BGR)
    samples["astronaut"] = astro
    group = cv2.imread(os.path.join(IMG_DIR, "t1.jpg"))
    for index, face in enumerate(sorted(face_service._detect_faces(group), key=lambda f: f.bbox[0])):
        x1, y1, x2, y2 = (int(v) for v in face.bbox)
        w, h = x2 - x1, y2 - y1
        cx, cy = (x1 + x2) // 2, (y1 + y2) // 2
        half = int(max(w, h) * 1.1)
        crop = group[max(0, cy - half): cy + half, max(0, cx - half): cx + half]
        crop = cv2.resize(crop, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
        samples[f"group{index}"] = crop
    return samples


def largest_face(img):
    faces = face_service._detect_faces(img)
    if not faces:
        return None
    return max(faces, key=face_service._get_face_area)


def add_fringe(img, face, coverage, seed=7):
    out = img.copy()
    x1, y1, x2, y2 = face.bbox
    kps = face.kps
    eye_mid = (kps[0] + kps[1]) / 2
    eye_dist = float(np.linalg.norm(kps[1] - kps[0]))
    brow_y = eye_mid[1] - 0.30 * eye_dist
    top = y1
    zone = max(brow_y - top, 1.0)
    bottom = top + coverage * zone
    w = x2 - x1
    left = x1 + 0.04 * w
    right = x2 - 0.04 * w
    n = 14
    xs = np.linspace(left, right, n)
    rng = np.random.default_rng(seed)
    jag = rng.uniform(-0.04, 0.04, n) * zone
    pts = [(left, top - 0.1 * zone), (right, top - 0.1 * zone)]
    for x, j in zip(xs[::-1], jag[::-1]):
        pts.append((x, bottom + j))
    cv2.fillPoly(out, [np.array(pts, dtype=np.int32)], (22, 22, 26))
    return out


def pad_probability(img, face):
    crop = _crop_face(img, tuple(float(v) for v in face.bbox))
    logits = passive_pad_service._session.run([], {passive_pad_service._input_name: crop[None]})[0][0]
    return float(1 / (1 + np.exp(-(logits[0] - logits[1]))))


def main():
    os.makedirs(os.environ.setdefault("OUT_DIR", "/tmp/face-robustness"), exist_ok=True)
    samples = load_samples()
    coverages = [0.0, 0.25, 0.5, 0.75, 1.0, 1.25]
    summary = {}
    detail = {}
    for name, img in samples.items():
        ref = largest_face(img)
        if ref is None:
            detail[name] = "no face in sample"
            continue
        ref_emb = np.asarray(ref.normed_embedding)
        detail[name] = []
        for cov in coverages:
            for seed in ((7, 11, 23) if cov > 0 else (7,)):
                occ = add_fringe(img, ref, cov, seed) if cov > 0 else img
                faces = face_service._detect_faces(occ)
                obs = face_service.extract_strict_face_observation(occ)
                row = {"coverage": cov, "seed": seed, "faces": len(faces), "strict_ok": obs is not None}
                if faces:
                    f = max(faces, key=face_service._get_face_area)
                    row["det"] = round(float(f.det_score), 3)
                    row["sim"] = round(float(np.dot(ref_emb, f.normed_embedding)), 3)
                    row["pad"] = round(pad_probability(occ, f), 3)
                detail[name].append(row)
        cv2.imwrite(os.path.join(os.environ["OUT_DIR"], f"{name}_cov50.png"), add_fringe(img, ref, 0.5))
    for cov in coverages:
        rows = [r for rows in detail.values() if isinstance(rows, list) for r in rows if r["coverage"] == cov]
        sims = [r["sim"] for r in rows if "sim" in r]
        pads = [r["pad"] for r in rows if "pad" in r]
        dets = [r["det"] for r in rows if "det" in r]
        summary[cov] = {
            "n": len(rows),
            "detected": f"{sum(1 for r in rows if r['faces'] == 1)}/{len(rows)}",
            "strict_ok": f"{sum(1 for r in rows if r['strict_ok'])}/{len(rows)}",
            "det_min": min(dets) if dets else None,
            "sim_min": min(sims) if sims else None,
            "sim_mean": round(float(np.mean(sims)), 3) if sims else None,
            "sim_below_0.45": sum(1 for v in sims if v < 0.45),
            "pad_min": min(pads) if pads else None,
            "pad_below_0.65": f"{sum(1 for v in pads if v < 0.65)}/{len(pads)}",
        }
    print(json.dumps({"faces": [k for k, v in detail.items() if isinstance(v, list)], "summary": summary}, indent=1))
    json.dump(detail, open(os.path.join(os.environ["OUT_DIR"], "forehead_detail.json"), "w"))


if __name__ == "__main__":
    main()
