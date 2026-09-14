# Colab helper - export 4 trained .keras models to TensorFlow.js GraphModel
!pip -q install tensorflowjs

import tensorflow as tf
from pathlib import Path
import os

MODELS = {
    "mobilenetv2": "/content/mobilenetv2.keras",
    "resnet50": "/content/resnet50.keras",
    "densenet121": "/content/densenet121.keras",
    "efficientnetb0": "/content/efficientnetb0.keras",
}

OUT_ROOT = Path("/content/postureguard_tfjs")
OUT_ROOT.mkdir(exist_ok=True)

for key, keras_path in MODELS.items():
    if not Path(keras_path).exists():
        print("SKIP - missing:", keras_path)
        continue

    model = tf.keras.models.load_model(keras_path)
    saved = f"/content/saved_{key}"
    out = OUT_ROOT / key

    tf.saved_model.save(model, saved)

    os.system(
        "tensorflowjs_converter "
        "--input_format=tf_saved_model "
        "--output_format=tfjs_graph_model "
        "--signature_name=serving_default "
        "--saved_model_tags=serve "
        f"{saved} {out}"
    )
    print("Exported", key, "->", out)

!cd /content && zip -qr postureguard_tfjs.zip postureguard_tfjs
print("Download /content/postureguard_tfjs.zip")
