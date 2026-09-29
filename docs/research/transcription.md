# Research: Word-timed transcription

Ticket: [#4](https://github.com/AlsoKnownAs-Ax/MotionBrief/issues/4) · Map: [#1](https://github.com/AlsoKnownAs-Ax/MotionBrief/issues/1) · Researched 2026-09-29

**Question.** How should MotionBrief derive a word-timed **Transcript** from a **Voiceover**? Compare local engines with hosted APIs on word-timing accuracy, bundling on Windows + macOS, cost/privacy, and MIT compatibility.

**Answer.** Default to **local whisper.cpp** running `large-v3-turbo` (quantized), with DTW token timestamps and word-split output, called as a sidecar binary. Download the model on first run; don't bundle it. Put transcription behind a small `Transcriber` interface. An optional bring-your-own-key API backend is worth *designing for* and is cheap to add, but it doesn't belong in the v1 critical path. Details in [Recommendation](#recommendation).

All prices and versions below are as published on 2026-09-29 and will drift.

---

## 1. What "word-timed" needs

Motion graphics sync to the start (and ideally end) of each spoken word, so each Transcript entry needs `{word, start, end}`. Whisper-family models have no native word timestamps. There are three ways to get them:

1. **Cross-attention + DTW** over Whisper's alignment heads. openai/whisper, whisper.cpp, faster-whisper and stable-ts use this. It's a single pass and adds no extra model.
2. **Forced alignment** of the transcript against a phoneme/character CTC model (wav2vec2). WhisperX does this. It needs a second model per language.
3. **Models or services with native word timings**: NVIDIA Parakeet-TDT, Deepgram, AssemblyAI, ElevenLabs Scribe.

WhisperX's authors describe Whisper's own timestamps as "at the utterance-level, not per word, and can be inaccurate by several seconds", and claim state-of-the-art word segmentation from adding VAD and forced phoneme alignment ([WhisperX README](https://github.com/m-bain/whisperX/blob/main/README.md), [paper, arXiv:2303.00747](https://arxiv.org/abs/2303.00747)). That criticism targets *segment* timestamps from vanilla Whisper. It doesn't cover the DTW word timestamps that whisper.cpp and faster-whisper now emit. **I found no first-party benchmark comparing DTW word timings with wav2vec2 forced alignment on clean single-speaker voiceover**, which is MotionBrief's case. That's the main open question; see [Uncertain](#uncertain--needs-a-prototype).

## 2. Local options

### whisper.cpp (recommended default)

- **License:** MIT ([LICENSE](https://github.com/ggml-org/whisper.cpp/blob/master/LICENSE)). Whisper weights are MIT ([openai/whisper LICENSE](https://github.com/openai/whisper/blob/main/LICENSE), [large-v3-turbo model card: `license: mit`](https://huggingface.co/openai/whisper-large-v3-turbo)).
- **Runtime:** "Plain C/C++ implementation without dependencies". No Python. Supported on macOS (Intel and Arm) and Windows (MSVC/MinGW) ([README](https://github.com/ggml-org/whisper.cpp/blob/master/README.md)).
- **Apple Silicon:** described as a "first-class citizen", with ARM NEON, Accelerate, Metal and Core ML. "On Apple Silicon, the inference runs fully on the GPU via Metal." The encoder can optionally run on the ANE via Core ML for ">x3 faster compared with CPU-only", but the Core ML model has to be generated with Python tooling, and "the first run on a device is slow" while the ANE compiles it ([README § Core ML](https://github.com/ggml-org/whisper.cpp/blob/master/README.md#core-ml-support)). Metal alone is enough; Core ML is optional.
- **Windows GPU:** CUDA (`-DGGML_CUDA=1`) and Vulkan (`-DGGML_VULKAN=1`, which works across NVIDIA/AMD/Intel drivers), plus OpenVINO ([README](https://github.com/ggml-org/whisper.cpp/blob/master/README.md#vulkan-gpu-support)).
- **Word timings:**
  - `-ml 1` gives word-level segments. The README still labels this "experimental" ([README § Word-level timestamp](https://github.com/ggml-org/whisper.cpp/blob/master/README.md#word-level-timestamp-experimental)).
  - `-sow` splits on words rather than tokens.
  - `-ojf` writes full JSON including per-token data.
  - `--dtw MODEL` computes DTW token-level timestamps ([CLI README](https://github.com/ggml-org/whisper.cpp/blob/master/examples/cli/README.md)).
  - DTW has alignment-head presets for every model, including `WHISPER_AHEADS_LARGE_V3_TURBO` ([whisper.h](https://github.com/ggml-org/whisper.cpp/blob/master/include/whisper.h)), and was ported from openai/whisper's implementation ([PR #1485](https://github.com/ggml-org/whisper.cpp/pull/1485), merged 2024-03-20).
  - The header still marks DTW token timestamps `[EXPERIMENTAL]`.
  - A built-in Silero VAD (`--vad`) trims silence ([README § VAD](https://github.com/ggml-org/whisper.cpp/blob/master/README.md#voice-activity-detection-vad)).
- **Binaries:**
  - Build releases (e.g. `b5130`, 2026-09-11) ship Windows zips: CPU x64 8.6 MB, BLAS x64 21.4 MB, cuBLAS 12.4 x64 674.5 MB, cuBLAS 11.8 x64 273 MB, and Win ARM64. For Apple there's only a 57 MB `xcframework`; **there is no prebuilt macOS CLI** ([releases API](https://api.github.com/repos/ggml-org/whisper.cpp/releases)).
  - So MotionBrief must build the macOS binary itself, either in its own CI or through a cmake step at setup (needs Xcode CLT).
  - The CUDA builds are huge. Ship Vulkan/CPU on Windows by default and treat CUDA as opt-in.
- **Model sizes** ([ggerganov/whisper.cpp on HF](https://huggingface.co/ggerganov/whisper.cpp/tree/main)):

  | Model | File |
  | --- | --- |
  | `large-v3-turbo` f16 | 1549 MiB |
  | `large-v3-turbo-q8_0` | 834 MiB |
  | `large-v3-turbo-q5_0` | **547 MiB** |
  | `large-v3` f16 / q5_0 | 2952 / 1031 MiB |
  | `small.en` f16 / q5_1 | 465 / 181 MiB |
  | `base.en` q5_1 | 57 MiB |

  large-v3-turbo is large-v3 with decoder layers cut from 32 to 4, 809 M params ([model card](https://huggingface.co/openai/whisper-large-v3-turbo)). Runtime memory for f16 models: small ~852 MB, medium ~2.1 GB, large ~3.9 GB ([README § Memory usage](https://github.com/ggml-org/whisper.cpp/blob/master/README.md#memory-usage)).
- **Speed (third-party but first-party-published):** on 13 min of audio, `small` on CPU (i7-12700K, 8 threads) took 2m05s with whisper.cpp against 1m42s for faster-whisper int8. `large-v2` on an RTX 3070 Ti took 1m05s against 1m03s ([faster-whisper README § Benchmark](https://github.com/SYSTRAN/faster-whisper/blob/master/README.md#benchmark), whisper.cpp v1.7.2). Single-stream speed is roughly on par with faster-whisper.

### faster-whisper

- **License:** MIT ([LICENSE](https://github.com/SYSTRAN/faster-whisper/blob/master/LICENSE)), built on CTranslate2 (MIT).
- **Word timings:** `model.transcribe(..., word_timestamps=True)` ([README](https://github.com/SYSTRAN/faster-whisper/blob/master/README.md#word-level-timestamps)). This is the same DTW approach as openai/whisper.
- **Bundling:** requires "Python 3.9 or greater". GPU "requires … cuBLAS for CUDA 12 [and] cuDNN 9", and the README points Windows users to a third-party archive for those DLLs ([README § Requirements](https://github.com/SYSTRAN/faster-whisper/blob/master/README.md#requirements)). CTranslate2 accelerates CPUs (MKL, oneDNN, OpenBLAS, Ruy, Apple Accelerate) and NVIDIA/ROCm GPUs, but **has no Metal backend** ([CTranslate2 README](https://github.com/OpenNMT/CTranslate2/blob/master/README.md)), so Apple Silicon runs CPU-only.
- **Verdict:** good accuracy and speed, but you ship a Python runtime and it can't use the Mac GPU. Only worth it if MotionBrief already embeds Python for another reason.

### WhisperX (Whisper + wav2vec2 forced alignment)

- **License:** BSD-2-Clause ([LICENSE](https://github.com/m-bain/whisperX/blob/main/LICENSE)), which is MIT-compatible. **Alignment-model licenses vary by language, though.** The default English model, torchaudio `WAV2VEC2_ASR_BASE_960H`, is MIT. The defaults for fr/de/es/it (`VOXPOPULI_ASR_BASE_10K_*`) are **CC BY-NC 4.0**, and so is torchaudio's multilingual `MMS_FA` ([whisperX alignment.py](https://github.com/m-bain/whisperX/blob/main/whisperx/alignment.py), [torchaudio pipelines impl.py](https://github.com/pytorch/audio/blob/main/src/torchaudio/pipelines/_wav2vec2/impl.py)). Other languages pull community HF checkpoints, each under its own license.
- **Bundling:** Python 3.10–3.13, `torch~=2.8`, `torchaudio~=2.8`, `pyannote-audio>=4`, `transformers`, faster-whisper. On macOS it installs **CPU-only PyTorch**, and on Windows it wants the CUDA 12.8 toolkit for GPU ([pyproject.toml](https://github.com/m-bain/whisperX/blob/main/pyproject.toml), [README § Setup](https://github.com/m-bain/whisperX/blob/main/README.md)). That's a multi-GB install, which is heavy for "one command for a stranger".
- **Known gaps:** "Transcript words which do not contain characters in the alignment models dictionary e.g. '2014.' or '£13.60' cannot be aligned and therefore are not given a timing" ([README § Limitations](https://github.com/m-bain/whisperX/blob/main/README.md#limitations)). Numbers and currency are common in explainer voiceovers.
- **Platform risk:** torchaudio is now in "maintenance phase"; features deprecated in 2.8 were removed in 2.9 ([torchaudio README](https://github.com/pytorch/audio/blob/main/README.md)). `forced_align` is still listed, but WhisperX pins torch 2.8.
- **Verdict:** keep it as an *accuracy reference* for a bake-off, not as the shipped engine. If DTW timing proves too loose, the forced-alignment idea can be ported without WhisperX: a wav2vec2 CTC model exported to ONNX and run via onnxruntime or sherpa-onnx.

### Other local options

| Option | License | Word timings | Bundling notes |
| --- | --- | --- | --- |
| **Parakeet-TDT 0.6B v3** (NVIDIA) via **sherpa-onnx** | Model **CC BY 4.0** ([card](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3)); requires attribution but is fine to redistribute and use commercially. sherpa-onnx is Apache-2.0 ([LICENSE](https://github.com/k2-fsa/sherpa-onnx/blob/master/LICENSE)) | Native: "Accurate word-level and segment-level timestamps" (card). sherpa-onnx exposes token `timestamps` in results ([docs](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/offline-transducer/nemo-transducer-models.html)) | `sherpa-onnx-node` 1.13.8 on npm ships prebuilt win-x64 and darwin-x64/arm64 packages ([npm](https://registry.npmjs.org/sherpa-onnx-node/latest)). There's an int8 ONNX conversion. **Only 25 European languages** (card). NVIDIA says it's optimized for NVIDIA GPUs; CPU/ONNX speed on Mac is unverified. |
| **stable-ts** | MIT ([LICENSE](https://github.com/jianfch/stable-ts/blob/main/LICENSE)) | DTW word timestamps plus silence-based refinement, and an alignment mode that fits a *known* text to audio ([README](https://github.com/jianfch/stable-ts/blob/main/README.md)) | Python/PyTorch, with the same bundling cost as WhisperX. |
| **whisper-timestamped** | **AGPL-3.0** ([LICENSE](https://github.com/linto-ai/whisper-timestamped/blob/master/LICENSE)) | DTW | Avoid: copyleft is incompatible with shipping it inside an MIT app. |
| **CrisperWhisper 2.0** | Code MIT, **weights non-commercial** ([README](https://github.com/nyrahealth/CrisperWhisper/blob/main/README.md)) | Tuned for word timing | Avoid: strangers could use it commercially. |
| **ctc-forced-aligner** | Default model is MMS-based ([README](https://github.com/MahmoudAshraf97/ctc-forced-aligner/blob/main/README.md)); MMS weights are CC BY-NC 4.0 (torchaudio `MMS_FA` doc above) | Forced alignment | Avoid the default model for the same reason. |

## 3. Hosted APIs (bring-your-own-key)

| Service | Word timestamps | List price (pre-recorded) | Data use |
| --- | --- | --- | --- |
| **OpenAI** | Only `whisper-1`, via `response_format=verbose_json` + `timestamp_granularities[]=word`. The guide recommends the newer `gpt-transcribe` by default and a specialized model "only if you need speaker labels, word timestamps, subtitle formats, or translation", and says "Use whisper-1 when you need word or segment timestamps". 25 MB file limit ([STT guide](https://platform.openai.com/docs/guides/speech-to-text)) | whisper-1 $0.006/min ([model page](https://platform.openai.com/docs/models/whisper-1)); gpt-transcribe $0.0045/min, but no word timings ([pricing](https://platform.openai.com/docs/pricing)) | Not used for training by default. Abuse-monitoring logs are kept up to 30 days ([data controls](https://platform.openai.com/docs/guides/your-data)) |
| **Deepgram** Nova-3 | `words[]` with `start`/`end`/`punctuated_word` returned by default ([pre-recorded docs](https://developers.deepgram.com/docs/pre-recorded-audio)) | Nova-3 mono $0.0043/min PAYG; Whisper Large $0.0048/min ([pricing](https://deepgram.com/pricing)) | Model Improvement Program is on unless each request sends `mip_opt_out=true` ([MIP docs](https://developers.deepgram.com/docs/the-deepgram-model-improvement-partnership-program)) |
| **AssemblyAI** | `words[]` with `start`/`end`/`confidence` ([export docs](https://www.assemblyai.com/docs/pre-recorded-audio/transcript-export-options)) | Universal-2 $0.15/hr (99 langs); Universal-3.5 Pro $0.21/hr (18 langs) ([pricing](https://www.assemblyai.com/pricing)) | Not verified (the FAQ page 404'd) |
| **ElevenLabs** Scribe v2 | "Precise word-level timestamps", 90+ languages ([docs](https://elevenlabs.io/docs/capabilities/speech-to-text)) | $0.22/hr ([API pricing](https://elevenlabs.io/pricing/api)) | Zero Retention Mode mentioned for the Medical tier; not verified for general use |
| **Groq** | `timestamp_granularities` `segment`, `word` (OpenAI-compatible) ([docs](https://console.groq.com/docs/speech-to-text)) | whisper-large-v3-turbo $0.04/hr; large-v3 $0.111/hr (same page) | Not verified |

Cost is negligible for a stranger: a 10-minute Voiceover costs $0.007–$0.06 on any of these. **The real costs are privacy and friction.** Every one of them uploads the user's voice to a third party and needs an account and key. Local transcription avoids both, and it's what an MIT app with "no hosted backend" should do by default.

## 4. Comparison summary

| | whisper.cpp | faster-whisper | WhisperX | Parakeet/sherpa-onnx | Hosted API |
| --- | --- | --- | --- | --- | --- |
| Word timing method | DTW (experimental flag) | DTW | Forced alignment (best documented) | Native TDT | Native (DG/AAI/11L) or DTW (OpenAI/Groq) |
| Python needed | No | Yes | Yes (+torch) | No (npm/C API) | No |
| Apple Silicon GPU | Metal (+ Core ML/ANE) | No (CPU) | No (CPU torch) | Unverified | n/a |
| Windows GPU | Vulkan / CUDA | CUDA 12 + cuDNN 9 | CUDA 12.8 toolkit | Unverified | n/a |
| Ship size (engine) | ~9–21 MB (Win CPU/BLAS); build on mac | Python + CT2 | Multi-GB | npm prebuilt | ~0 |
| Model download | 547 MiB (turbo q5_0) | ~similar | Whisper + wav2vec2 per lang | int8 ONNX | none |
| Languages | 99 | 99 | Per-language aligner | 25 European | varies |
| License risk | None (MIT) | None (MIT) | Non-English aligners CC BY-NC | Attribution (CC BY 4.0) | ToS/privacy |

## Recommendation

**Default: local whisper.cpp as a sidecar binary.**

- **Engine and model:** use `large-v3-turbo-q5_0` (547 MiB), downloaded from Hugging Face on first run with a progress bar and checksum. Offer `small.en-q5_1` (181 MiB) as a "fast/low-memory" choice.
- **Invocation:** `--dtw large.v3.turbo -ojf --vad`. Build word entries from token data (`-sow`/`-ml 1` as a simpler fallback) and map them to the Transcript `{word, start, end}` shape.

Why:

- MIT all the way down (code and weights). No license traps, unlike WhisperX's non-English aligners, CrisperWhisper, whisper-timestamped and MMS.
- No Python/PyTorch. That keeps "one command for a stranger" realistic and the download small (~10–20 MB of engine).
- It's the only candidate with first-class GPU on **both** targets: Metal on Apple Silicon, Vulkan on any Windows GPU.
- Private and free: the Voiceover never leaves the machine.

**Packaging consequence:** whisper.cpp doesn't publish macOS CLI binaries, so MotionBrief's CI must build universal/arm64 macOS binaries, or setup must run cmake. Feed this to the *Packaging & distribution* and *First-run onboarding* open items on the map.

**Keep a seam for accuracy.** Wrap transcription in a `Transcriber` interface (Voiceover in, Transcript out). If the prototype shows DTW word boundaries are too loose for motion sync, add a second-pass aligner behind the same interface: an MIT wav2vec2 CTC model (e.g. torchaudio `WAV2VEC2_ASR_BASE_960H` for English) run through onnxruntime. Don't pull in WhisperX. Parakeet-TDT via `sherpa-onnx-node` is the strongest alternative engine for English/European Voiceovers and belongs in the bake-off.

**API fallback: worth offering, but optional and not in the v1 critical path.** The only users it really helps are those on weak hardware (Intel Macs, low-end Windows laptops without a usable GPU), where large-v3-turbo on CPU may be slow. The interface above makes it a small addition, and cost is trivial (under $0.06 per 10-minute Voiceover). If one is shipped, prefer a service with **native** word timings over OpenAI `whisper-1`, which is the same Whisper DTW approach and adds no accuracy. **Deepgram Nova-3** is the pragmatic pick: a synchronous REST response with `words[]`, $0.0043/min, and per-request `mip_opt_out=true` to keep audio out of training. Always send `mip_opt_out=true`, make the upload explicit in the UI, and never enable the API silently.

## Uncertain / needs a prototype

1. **DTW vs forced-alignment word accuracy on clean voiceover.** I found no primary-source numbers. Test a few real Voiceovers through whisper.cpp (DTW), WhisperX, Parakeet (sherpa-onnx) and Deepgram, and measure onset error against hand-marked word starts. The yardstick is the ~33 ms frame budget at 30 fps.
2. **whisper.cpp flag behavior:** whether `--dtw` combined with `-ojf` gives better word boundaries than `-ml 1 -sow` alone, and how whisper.cpp handles numbers and punctuation in word splitting.
3. **CPU-only speed** of large-v3-turbo on modest hardware, which decides how much the API fallback matters. The only first-party CPU numbers are for `small` on an i7-12700K.
4. **Vulkan build size and stability** on Windows. The official releases list CPU/BLAS/CUDA zips but no Vulkan zip, so it may need a self-built binary.
5. Data retention terms for AssemblyAI, ElevenLabs and Groq weren't verified.
