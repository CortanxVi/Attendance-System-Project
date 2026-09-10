# Third-party model notices

## MediaPipe Face Landmarker

- Runtime: `@mediapipe/tasks-vision` 1.0.1
- Model source: Google MediaPipe Face Landmarker float16, revision 1
- Local artifact: `frontend/public/models/face_landmarker.task`
- SHA-256: `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`
- License: Apache License 2.0; see the MediaPipe package and upstream project for notices.

## MiniFAS V2 SE passive PAD

- Source: `facenox/face-antispoof-onnx`, commit `fa6489fb221dcf6b803095ab4b15a0fa0f56cfe5`
- Local artifact: `backend/models/minifas_v2_se_quantized.onnx`
- SHA-256: `fde20585635cae62ed1d41796f76b6f8bc4b92cd91ec1cf0f1bc6485d2d587a9`
- Architecture lineage: Minivision Silent-Face-Anti-Spoofing / MiniFAS
- License stated by the source repository: Apache License 2.0.

The passive PAD model is a security signal, not a guarantee or an ISO/IEC 30107 certification. Its threshold must be evaluated with the production cameras, lighting, and target population before rollout.

## InsightFace buffalo_s

- Runtime code: `insightface` 1.0.1
- Required pretrained artifacts: `1k3d68.onnx`, `det_500m.onnx`, and `w600k_mbf.onnx`
- Integrity manifest: `backend/models/insightface-buffalo-s.sha256`
- The upstream project states that its code is MIT licensed, while its supplied training data and pretrained models are limited to non-commercial research unless a separate model license is obtained.

The project owner must confirm and document that the intended attendance deployment is covered by the pretrained-model terms, or obtain an appropriate license/replacement model before a full production release. Technical test success does not resolve this licensing requirement.
