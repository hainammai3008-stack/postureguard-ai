# Dynamic models

Bản v4 không cần commit model vào Netlify.

Model được upload qua tab **Cấu hình hệ thống** lên Supabase Storage bucket `ai-models`.

Path:

ai-models/{model_key}/{version}/model.json
ai-models/{model_key}/{version}/*.bin
