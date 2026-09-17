"""Build the standard five-class dataset from the source export."""

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
OUTPUT = ROOT / "colab/posture_dataset_standard_5class"
CLASSES = ("leaning_backward", "leaning_forward", "leaning_left", "leaning_right", "upright")
EVAL_PER_CLASS = 80
SEED = 20260917


def stem(filename):
    return re.sub(r"\.rf\.[^.]+\.jpg$", "", filename)


def group(filename):
    original = stem(filename)
    match = re.match(r"(extract|mb|VidWebCam_frame_)(\d+)", original)
    return f"{match[1]}_{int(match[2]) // 100}" if match else re.sub(r"\d+", "N", original)


def candidates():
    with zipfile.ZipFile(SOURCE) as archive:
        records = []
        labels_by_stem = defaultdict(set)
        for source_split in ("train", "valid", "test"):
            for row in csv.DictReader(io.StringIO(archive.read(f"{source_split}/_classes.csv").decode("utf-8-sig"))):
                labels = [key.strip() for key, value in row.items() if key != "filename" and value.strip() == "1"]
                records.append((source_split, row["filename"], labels))
                labels_by_stem[stem(row["filename"])].update(labels)
        output, rejected, seen = [], Counter(), set()
        for source_split, filename, labels in records:
            if len(labels) != 1 or labels[0] not in CLASSES:
                rejected["unsupported_or_ambiguous_label"] += 1
                continue
            if len(labels_by_stem[stem(filename)]) != 1:
                rejected["conflicting_original_frame_label"] += 1
                continue
            source_path = f"{source_split}/{filename}"
            data = archive.read(source_path)
            try:
                with Image.open(io.BytesIO(data)) as image:
                    image.verify()
            except Exception:
                rejected["invalid_image"] += 1
                continue
            digest = hashlib.sha256(data).hexdigest()
            if digest in seen:
                rejected["identical_image"] += 1
                continue
            seen.add(digest)
            output.append({"source_path": source_path, "class": labels[0], "source_group": group(filename), "sha256": digest})
        return output, rejected


def choose_splits(items):
    groups = defaultdict(list)
    for item in items:
        groups[item["source_group"]].append(item)
    keys = sorted(groups)
    rng = random.Random(SEED)
    best = None
    for _ in range(20000):
        order = keys[:]
        rng.shuffle(order)
        val = set(order[:round(len(order) * .2)])
        test = set(order[round(len(order) * .2):round(len(order) * .4)])
        counts = {split: Counter(item["class"] for key in selected for item in groups[key]) for split, selected in (("val", val), ("test", test))}
        minimum = min(counts[split][label] for split in ("val", "test") for label in CLASSES)
        train_counts = Counter(item["class"] for key in keys if key not in val and key not in test for item in groups[key])
        score = (min(minimum, EVAL_PER_CLASS), min(train_counts.values()), minimum)
        if best is None or score > best[0]:
            best = (score, val, test)
    if best[0][0] < EVAL_PER_CLASS:
        raise RuntimeError(f"Could only allocate {best[0][0]} images per evaluation class")
    return {key: "val" if key in best[1] else "test" if key in best[2] else "train" for key in keys}


def main():
    if OUTPUT.exists():
        raise SystemExit(f"Output already exists: {OUTPUT}")
    items, rejected = candidates()
    splits = choose_splits(items)
    rng = random.Random(SEED)
    selected = []
    for split in ("train", "val", "test"):
        for label in CLASSES:
            batch = sorted((item for item in items if splits[item["source_group"]] == split and item["class"] == label), key=lambda item: item["source_path"])
            rng.shuffle(batch)
            selected.extend((split, item) for item in (batch if split == "train" else batch[:EVAL_PER_CLASS]))
    OUTPUT.mkdir(parents=True)
    manifest = []
    with zipfile.ZipFile(SOURCE) as archive:
        for split, item in selected:
            relative = Path(split) / item["class"] / f"{item['sha256'][:20]}.jpg"
            destination = OUTPUT / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(archive.read(item["source_path"]))
            manifest.append({"path": str(relative), "split": split, **item, "source_zip": SOURCE.name})
    with (OUTPUT / "dataset_manifest.csv").open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=manifest[0].keys())
        writer.writeheader()
        writer.writerows(manifest)
    report = {"status": "standard_five_class_dataset", "seed": SEED, "source": SOURCE.name, "classes": CLASSES, "counts": {split: dict(Counter(item["class"] for item in manifest if item["split"] == split)) for split in ("train", "val", "test")}, "rejected": dict(rejected), "limitations": ["Source labels have not undergone full manual review.", "Source person/video identities are unavailable; 100-frame groups reduce but do not eliminate leakage.", "The source export has strong class/split imbalance; evaluation uses balanced subsets."]}
    (OUTPUT / "dataset_report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
