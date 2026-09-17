"""Build a reproducible four-class dataset from the downloaded Roboflow export."""

import csv
import hashlib
import io
import json
import random
import re
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "colab/dataset/Sitting Posture Classification.v5i.multiclass.zip"
OUTPUT = ROOT / "colab/posture_dataset_standard"
CLASSES = ("leaning_backward", "leaning_left", "leaning_right", "upright")
SEED = 20260917
EVAL_PER_CLASS = 80


def original_name(filename):
    return re.sub(r"\.rf\.[^.]+\.jpg$", "", filename)


def group_name(filename):
    stem = original_name(filename)
    match = re.match(r"(extract|mb|VidWebCam_frame_)(\d+)", stem)
    if match:
        return f"{match[1]}_{int(match[2]) // 100}"
    return re.sub(r"\d+", "N", stem)


def load_candidates():
    candidates = []
    rejected = Counter()
    with zipfile.ZipFile(SOURCE) as archive:
        rows = list(csv.DictReader(io.StringIO(archive.read("train/_classes.csv").decode("utf-8-sig"))))
        names = defaultdict(set)
        for row in rows:
            labels = [key.strip() for key, value in row.items() if key != "filename" and value.strip() == "1"]
            names[original_name(row["filename"])].update(labels)
        seen_hash = {}
        for row in rows:
            labels = [key.strip() for key, value in row.items() if key != "filename" and value.strip() == "1"]
            if len(labels) != 1 or labels[0] not in CLASSES:
                rejected["unsupported_or_ambiguous_label"] += 1
                continue
            if len(names[original_name(row["filename"])]) != 1:
                rejected["conflicting_original_frame_label"] += 1
                continue
            path = "train/" + row["filename"]
            data = archive.read(path)
            try:
                with Image.open(io.BytesIO(data)) as image:
                    image.verify()
            except Exception:
                rejected["invalid_image"] += 1
                continue
            digest = hashlib.sha256(data).hexdigest()
            if digest in seen_hash:
                rejected["identical_image"] += 1
                continue
            seen_hash[digest] = labels[0]
            candidates.append({"path": path, "label": labels[0], "group": group_name(row["filename"]), "sha256": digest})
    return candidates, rejected


def assign_groups(candidates):
    groups = defaultdict(list)
    for item in candidates:
        groups[item["group"]].append(item)
    keys = sorted(groups)
    rng = random.Random(SEED)
    best = None
    for _ in range(12000):
        order = keys[:]
        rng.shuffle(order)
        test = set(order[:round(len(order) * 0.2)])
        val = set(order[round(len(order) * 0.2):round(len(order) * 0.4)])
        counts = {split: Counter(item["label"] for key in selected for item in groups[key]) for split, selected in (("test", test), ("val", val))}
        minimum = min(counts[split][label] for split in ("test", "val") for label in CLASSES)
        backward_train = sum(item["label"] == "leaning_backward" for key in keys if key not in test and key not in val for item in groups[key])
        score = (min(minimum, EVAL_PER_CLASS), min(backward_train, 300), minimum, -sum(abs(counts[split][label] - 100) for split in ("test", "val") for label in CLASSES))
        if best is None or score > best[0]:
            best = (score, test, val)
    if best[0][0] < EVAL_PER_CLASS:
        raise RuntimeError(f"Could only allocate {best[0][0]} images per evaluation class")
    test, val = best[1:]
    split_by_group = {key: "test" if key in test else "val" if key in val else "train" for key in keys}
    return split_by_group


def build():
    if OUTPUT.exists():
        raise SystemExit(f"Output already exists: {OUTPUT}. Move or remove it before rebuilding.")
    candidates, rejected = load_candidates()
    splits = assign_groups(candidates)
    rng = random.Random(SEED)
    selected = []
    for split in ("train", "val", "test"):
        for label in CLASSES:
            batch = [item for item in candidates if splits[item["group"]] == split and item["label"] == label]
            batch.sort(key=lambda item: item["path"])
            rng.shuffle(batch)
            if split != "train":
                batch = batch[:EVAL_PER_CLASS]
            selected.extend((split, item) for item in batch)
    OUTPUT.mkdir(parents=True)
    manifest = []
    with zipfile.ZipFile(SOURCE) as archive:
        for split, item in selected:
            filename = f"{item['sha256'][:20]}.jpg"
            relative = Path(split) / item["label"] / filename
            destination = OUTPUT / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(archive.read(item["path"]))
            manifest.append({"path": str(relative), "split": split, "class": item["label"], "source_zip": SOURCE.name, "source_path": item["path"], "source_group": item["group"], "sha256": item["sha256"]})
    with (OUTPUT / "dataset_manifest.csv").open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=manifest[0].keys())
        writer.writeheader()
        writer.writerows(manifest)
    counts = {split: dict(Counter(item["class"] for item in manifest if item["split"] == split)) for split in ("train", "val", "test")}
    report = {"seed": SEED, "source": SOURCE.name, "classes": CLASSES, "counts": counts, "rejected": dict(rejected), "source_group_rule": "Numbered extract/mb/webcam frames grouped in blocks of 100", "limitations": ["Labels originate from the source CSV and have not been manually reviewed.", "Frame blocks reduce leakage, but original person/video identities are unavailable.", "Evaluation sets are balanced subsets; unused source images are intentionally omitted."]}
    (OUTPUT / "dataset_report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    build()
