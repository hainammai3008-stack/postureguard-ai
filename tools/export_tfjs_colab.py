# Chạy trên Google Colab sau khi đã có /content/image_classifier_v1.keras
# Mục tiêu: xuất TF.js GraphModel để browser dùng tf.loadGraphModel().

!pip -q install tensorflowjs

import tensorflow as tf
from pathlib import Path

KERAS_PATH = "/content/image_classifier_v1.keras"
SAVED_MODEL_DIR = "/content/posture_saved_model"
TFJS_DIR = "/content/posture_tfjs_model"

model = tf.keras.models.load_model(KERAS_PATH)
print("Input:", model.input_shape, "Output:", model.output_shape)

# Notebook gốc đã chứa mobilenet_v2.preprocess_input bên trong model.
# Vì vậy export nguyên model để browser nhận RGB float 0..255 giống Colab.
tf.saved_model.save(model, SAVED_MODEL_DIR)

!tensorflowjs_converter \
  --input_format=tf_saved_model \
  --output_format=tfjs_graph_model \
  --signature_name=serving_default \
  --saved_model_tags=serve \
  {SAVED_MODEL_DIR} \
  {TFJS_DIR}

print("TF.js files:")
for p in Path(TFJS_DIR).iterdir():
    print("-", p.name)

!cd /content && zip -qr posture_tfjs_model.zip posture_tfjs_model
print("Download: /content/posture_tfjs_model.zip")
