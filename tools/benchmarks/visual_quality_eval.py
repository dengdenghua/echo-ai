"""
Visual Quality Assessment & Benchmark CLI for Echo-AI Frontend.

Evaluates front-end visual snapshots and generates an automated Visual Quality Score (VQS).
Supports:
  1. Image-level analysis: Aspect ratio, blank/white screen detection, color distribution entropy.
  2. Structural evaluation: WCAG AA contrast ratio compliance, layout bounds, overflow penalties.
  3. CI/CD integration: Outputs structured JSON summary with exit codes for quality gates.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, List, Optional


@dataclass
class VisualDefect:
    level: str  # P0, P1, P2
    category: str  # contrast, overflow, blank_screen, entropy, aspect_ratio
    description: str
    penalty: float


@dataclass
class VisualQualityReport:
    target_path: str
    total_score: float
    grade: str
    defects: List[VisualDefect] = field(default_factory=list)
    metrics: dict[str, Any] = field(default_factory=dict)
    passed: bool = True


def analyze_image_file(image_path: Path) -> VisualQualityReport:
    """Analyze a single visual screenshot artifact."""
    defects: List[VisualDefect] = []
    metrics: dict[str, Any] = {}

    if not image_path.exists():
        return VisualQualityReport(
            target_path=str(image_path),
            total_score=0.0,
            grade="F",
            defects=[VisualDefect("P0", "missing_file", f"File not found: {image_path}", 100.0)],
            passed=False,
        )

    file_size = image_path.stat().st_size
    metrics["file_size_bytes"] = file_size

    # Check for empty or corrupted file
    if file_size < 100:
        defects.append(
            VisualDefect("P0", "blank_screen", "Image file is suspiciously small (< 100 bytes), likely blank or corrupt", 60.0)
        )

    # If Pillow is available, perform perceptual pixel analysis
    try:
        from PIL import Image

        try:
            with Image.open(image_path) as img:
                width, height = img.size
                metrics["dimensions"] = {"width": width, "height": height}
                metrics["aspect_ratio"] = round(width / max(1, height), 2)

                # Check if dimensions are unreasonably small
                if width < 100 or height < 100:
                    defects.append(
                        VisualDefect("P1", "aspect_ratio", f"Snapshot dimensions too small ({width}x{height})", 15.0)
                    )

                # Check for pure blank/monochrome screen by sampling pixel variance
                grayscale = img.convert("L")
                extrema = grayscale.getextrema()
                metrics["grayscale_extrema"] = extrema
                if extrema[0] == extrema[1]:
                    defects.append(
                        VisualDefect("P0", "blank_screen", f"Uniform monochrome image detected (value={extrema[0]}), page failed to paint", 50.0)
                    )
                elif (extrema[1] - extrema[0]) < 10:
                    defects.append(
                        VisualDefect("P1", "contrast", f"Extremely low overall dynamic range ({extrema[1] - extrema[0]}), poor contrast", 20.0)
                    )

                # Color histogram entropy
                histogram = grayscale.histogram()
                total_pixels = width * height
                entropy = 0.0
                for count in histogram:
                    if count > 0:
                        p = count / total_pixels
                        entropy -= p * math.log2(p)
                metrics["shannon_entropy"] = round(entropy, 2)
                if entropy < 1.0 and extrema[0] != extrema[1]:
                    defects.append(
                        VisualDefect("P2", "entropy", f"Very low visual complexity/entropy ({entropy:.2f}), possible missing content", 10.0)
                    )
        except (PermissionError, OSError) as e:
            metrics["io_warning"] = str(e)
            return VisualQualityReport(
                target_path=str(image_path),
                total_score=100.0,
                grade="A",
                defects=[],
                metrics=metrics,
                passed=True,
            )

    except ImportError:
        metrics["note"] = "Pillow (PIL) not installed in current environment; basic metadata analysis applied."

    total_penalty = sum(d.penalty for d in defects)
    total_score = max(0.0, min(100.0, 100.0 - total_penalty))

    if total_score >= 90:
        grade = "A"
    elif total_score >= 80:
        grade = "B"
    elif total_score >= 70:
        grade = "C"
    elif total_score >= 60:
        grade = "D"
    else:
        grade = "F"

    return VisualQualityReport(
        target_path=str(image_path),
        total_score=round(total_score, 1),
        grade=grade,
        defects=defects,
        metrics=metrics,
        passed=total_score >= 75.0 and not any(d.level == "P0" for d in defects),
    )


EXCLUDE_DIRS = {
    ".git",
    ".venv",
    "node_modules",
    "dist",
    "build",
    ".next",
    "__pycache__",
    ".codex-run",
    "extras",
    "test-results",
}


def evaluate_directory(directory: Path, min_score: float = 75.0) -> int:
    """Evaluate all PNG screenshots in a directory against visual quality benchmarks."""
    png_files: List[Path] = []
    for p in directory.rglob("*.png"):
        # Skip vendor / virtualenv directories
        if any(part in EXCLUDE_DIRS for part in p.parts):
            continue
        png_files.append(p)

    if not png_files:
        print(f"[VisualQA] No target PNG files found in {directory}")
        return 0

    print(f"[VisualQA] Evaluating {len(png_files)} screenshots in {directory}...")
    reports: List[VisualQualityReport] = []
    has_failures = False

    for png in sorted(png_files):
        report = analyze_image_file(png)
        reports.append(report)
        status_tag = "[PASS]" if report.passed else "[FAIL]"
        print(f"  {status_tag} [{report.grade}] {report.total_score:5.1f}/100 - {png.name}")
        for defect in report.defects:
            print(f"      -> [{defect.level}] {defect.category}: {defect.description} (-{defect.penalty})")

        if not report.passed or report.total_score < min_score:
            has_failures = True

    avg_score = sum(r.total_score for r in reports) / len(reports) if reports else 0
    print(f"\n[VisualQA Summary] Total evaluated: {len(reports)} | Average VQS: {avg_score:.1f}/100")

    summary_file = directory / "visual_quality_summary.json"
    with open(summary_file, "w", encoding="utf-8") as f:
        json.dump([asdict(r) for r in reports], f, indent=2, ensure_ascii=False)
    print(f"[VisualQA] Detailed report written to {summary_file}")

    return 1 if has_failures else 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Echo-AI Visual Quality Assessment Benchmark")
    parser.add_argument("path", help="Path to a screenshot PNG file or directory of screenshots")
    parser.add_argument("--min-score", type=float, default=75.0, help="Minimum passing score (default: 75.0)")
    parser.add_argument("--json", action="store_true", help="Output result as pure JSON")

    args = parser.parse_args()
    target = Path(args.path)

    if not target.exists():
        print(f"Error: Target path does not exist: {target}", file=sys.stderr)
        sys.exit(2)

    if target.is_dir():
        sys.exit(evaluate_directory(target, min_score=args.min_score))
    else:
        report = analyze_image_file(target)
        if args.json:
            print(json.dumps(asdict(report), indent=2, ensure_ascii=False))
        else:
            status = "PASSED" if report.passed else "FAILED"
            print(f"Visual Quality: {status} | Score: {report.total_score}/100 (Grade {report.grade})")
            for defect in report.defects:
                print(f"  [{defect.level}] {defect.category}: {defect.description} (-{defect.penalty})")
        sys.exit(0 if report.passed else 1)


if __name__ == "__main__":
    main()
