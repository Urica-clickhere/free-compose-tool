# Dolce browser OMR dependency

Source: https://github.com/lodebar2026/dolce
Pinned commit: 57ae7403d2a193f90e096af46a50bab004042cdb (0.8.5)
License: MIT; see LICENSE.

scripts/prepare-omr.mjs downloads the pinned source archive at build time, validates its SHA-256, and extracts the unmodified sources and bundled PaddleOCR models. Vite bundles only reachable browser modules. The archive is cached locally; generated sources and model copies are ignored by Git. Model files originate from PaddleOCR (Apache-2.0); ONNX Runtime is MIT licensed. All runtime files are hosted with the app; no image is submitted to an inference API.
