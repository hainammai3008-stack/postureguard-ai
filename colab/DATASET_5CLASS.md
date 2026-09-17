# Standard five-class posture dataset

Run `python3 scripts/build_standard_5class_dataset.py` from the repository root after placing `Sitting Posture Classification.v5i.multiclass.zip` in `colab/dataset/`.

The generated folder and ZIP are `colab/posture_dataset_standard_5class/` and `colab/posture_dataset_standard_5class.zip`. Classes, in the intended model output order, are `leaning_backward`, `leaning_forward`, `leaning_left`, `leaning_right`, `upright`. `head_down` is outside the agreed scope.

The source export's train/valid/test splits omit some classes. This builder combines them, removes contradictory labels for the same original frame, keeps numbered frames in 100-frame groups, then creates one reproducible split for all four model architectures. Validation and test each contain 80 images per class. The manifest records each image's original ZIP path and SHA-256.

Use these fixed directories in every notebook. Do not re-split per model or evaluate a five-output model with the old four-class label order. The existing app and models still use four classes; integration requires training/export and updating model metadata and app behavior.

Dataset images and ZIP archives are stored outside Git. Keep a copy of `posture_dataset_standard_5class.zip` in your own storage and upload it when a notebook prompts for the dataset. On a new machine, you can also place the ZIP at `colab/posture_dataset_standard_5class.zip`; Git ignores it. The optional `scripts/assemble_standard_5class_dataset.py` script works only if you have kept the four local files and manifest in `colab/dataset_parts/`.

Upload that ZIP when prompted by each notebook's dataset cell in a fresh Colab runtime. Run cells from top to bottom. Each exported SavedModel ZIP contains `class_names.json` with the same class order. Keep this file with the model artifact when converting to TensorFlow.js so the browser output mapping can be checked before activation.

Source labels have not had a full manual review, and person/video IDs are unavailable. Grouped frames reduce leakage but cannot establish generalization to new people. A future external test should use new people and verified labels.
