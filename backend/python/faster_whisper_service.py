"""
Faster-Whisper GPU transcription micro-service

Usage (CLI):
  python faster_whisper_service.py --audio "path/to/audio.wav" --model small --language auto

Output:
  Prints JSON to stdout with structure:
  {
    "text": "...",
    "segments": [
      {
        "text": "...",
        "start": 0.0,
        "end": 3.2,
        "words": [
          { "word": "hello", "start": 0.0, "end": 0.3 },
          ...
        ]
      },
      ...
    ]
  }

This script is intentionally simple: it loads a Faster-Whisper model on CUDA
and transcribes a single audio file, returning rich timestamps for use in
karaoke-style subtitles.
"""

import argparse
import json
import sys
from typing import Any, Dict, List

try:
  from faster_whisper import WhisperModel
except ImportError as e:
  sys.stderr.write(
    "[GPU-Whisper] faster-whisper is not installed. Install with:\n"
    "  pip install faster-whisper\n"
  )
  raise


def parse_args() -> argparse.Namespace:
  parser = argparse.ArgumentParser(description="Faster-Whisper GPU transcription service")
  parser.add_argument("--audio", required=True, help="Path to audio file")
  parser.add_argument(
    "--model",
    default="small",
    help="Whisper model size/name (e.g. tiny, base, small, medium, large-v3)",
  )
  parser.add_argument(
    "--language",
    default="auto",
    help="Language code (e.g. 'en', 'vi') or 'auto' for auto-detect",
  )
  parser.add_argument(
    "--beam_size",
    type=int,
    default=5,
    help="Beam size for beam search (larger = more accurate, slower)",
  )
  return parser.parse_args()


def transcribe_gpu(audio_path: str, model_size: str, language: str, beam_size: int) -> Dict[str, Any]:
  """
  Run Faster-Whisper on GPU with word-level timestamps enabled.
  """
  # Load model on CUDA with float16 for speed/memory efficiency
  # Requires a CUDA-capable GPU and proper CUDA/cuDNN installation.
  model = WhisperModel(
    model_size,
    device="cuda",
    compute_type="float16",
  )

  # Configure language
  lang = None if language == "auto" else language

  # Transcribe with word timestamps
  segments_generator, info = model.transcribe(
    audio_path,
    language=lang,
    beam_size=beam_size,
    word_timestamps=True,
  )

  segments: List[Dict[str, Any]] = []
  full_text_parts: List[str] = []

  for seg in segments_generator:
    seg_dict: Dict[str, Any] = {
      "text": seg.text or "",
      "start": float(seg.start),
      "end": float(seg.end),
      "words": [],
    }

    full_text_parts.append(seg.text or "")

    # seg.words may be None if word timestamps are not available
    if getattr(seg, "words", None):
      for w in seg.words:
        if not w.word or w.start is None or w.end is None:
          continue
        seg_dict["words"].append(
          {
            "word": w.word,
            "start": float(w.start),
            "end": float(w.end),
          }
        )

    segments.append(seg_dict)

  result: Dict[str, Any] = {
    "text": " ".join(full_text_parts).strip(),
    "segments": segments,
  }
  return result


def main() -> None:
  args = parse_args()

  try:
    result = transcribe_gpu(
      audio_path=args.audio,
      model_size=args.model,
      language=args.language,
      beam_size=args.beam_size,
    )
    json.dump(result, sys.stdout, ensure_ascii=False)
  except Exception as e:
    # Print structured error to stderr so the caller can inspect it
    sys.stderr.write(f"[GPU-Whisper] Error: {e}\n")
    sys.exit(1)


if __name__ == "__main__":
  main()








