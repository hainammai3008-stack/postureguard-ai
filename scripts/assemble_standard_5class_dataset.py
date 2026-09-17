"""Reassemble a five-class dataset ZIP from optional local parts."""

import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PARTS = ROOT / "colab/dataset_parts"
MANIFEST = PARTS / "manifest.json"


def main():
    metadata = json.loads(MANIFEST.read_text())
    output = ROOT / "colab" / metadata["archive"]
    if output.exists():
        existing = hashlib.sha256(output.read_bytes()).hexdigest()
        if existing == metadata["archive_sha256"]:
            print(f"Already verified: {output}")
            return
        raise SystemExit(f"Existing ZIP has a different hash: {output}")
    digest = hashlib.sha256()
    with output.open("wb") as stream:
        for record in metadata["parts"]:
            path = PARTS / record["file"]
            data = path.read_bytes()
            if len(data) != record["size"] or hashlib.sha256(data).hexdigest() != record["sha256"]:
                output.unlink(missing_ok=True)
                raise SystemExit(f"Dataset part failed verification: {path}")
            digest.update(data)
            stream.write(data)
    if digest.hexdigest() != metadata["archive_sha256"]:
        output.unlink(missing_ok=True)
        raise SystemExit("Reassembled dataset ZIP failed verification")
    print(f"Ready: {output}")


if __name__ == "__main__":
    main()
