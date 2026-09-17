# PostureGuard standard four-class dataset

Run `python3 scripts/build_standard_dataset.py` from the repository root after placing the downloaded ZIPs in `colab/dataset/`. The generated folder is `colab/posture_dataset_standard/`; all four training notebooks should use its `train`, `val`, and `test` directories without making new random splits.

The builder uses `Sitting Posture Classification.v5i.multiclass.zip` only. Its `train/_classes.csv` contains all four product classes. The export's original validation and test splits have missing classes, so they are not used. The other downloaded ZIPs contain binary, ambiguous, or incompatible classes and are not automatically mapped to left/right/backward/upright.

The build removes contradictory source-frame labels and byte-identical images. Numbered source frames are kept in blocks of 100 within one split. Val and test each contain 80 images per class; train keeps all eligible images in its assigned groups. The seed is fixed at 20260917. `dataset_manifest.csv` records provenance and SHA-256 for every selected image, and `dataset_report.json` records counts and exclusions.

This is a reproducible starting benchmark, not a fully independent real-world test: source person/video identities are unavailable and many frames depict the same people. Labels were inherited from Roboflow and only spot checked visually. Before claiming performance on new students, collect a separate consented test set from people absent from training and manually review its labels.
