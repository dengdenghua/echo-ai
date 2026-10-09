---
type: "RuntimeSubsystem"
title: "All Skills 目录"
description: "全仓 Skill 目录 · 每个 skill 分 group / atomic 标记 · 决定哪个 arm 能包含它。"
tags: ["backend", "runtime"]
tier: "core"
---
# All Skills 目录

> 全仓 Skill 目录 · 每个 skill 分 group / atomic 标记 · 决定哪个 arm 能包含它。

**Source**: `runtime/execution/all_skills/`

## Package summary

runtime.execution.all_skills · unified skill catalog.

## Exports

- `ALL_SKILL_IDS`
- `BASE_SKILL_IDS`
- `skill_group`
- `skill_kind`
- `skills_in_group`
- `register_all`
- `register_base`
- `register_subset`
- `register_group`
- `WEB_ONLY_GROUPS`
- `is_known_but_disabled_tool`

## Modules

| Module | Summary |
| --- | --- |
| `auto-stat-test/scripts/statistical_test_suite.py` | statistical_test_suite.py — 根据数据自动选择统计检验并输出通俗解读 |
| `cn-finance-data/scripts/api_client.py` | Tushare API 客户端 |
| `code-vuln-audit/scripts/security_scan.py` | security_scan.py — 代码安全扫描工具 |
| `pricing-advisor/scripts/pricing_modeler.py` | Pricing modeler — projects revenue at different price points and recommends tier structure. |
| `seedance-video-generate/scripts/seedance_video_generate.py` | Seedance Video Generation Skill for Echo-Agent Uses Volcano Engine Seedance API to generate videos from text, images, or existing videos. |
| `seedream-image-generate/scripts/seedream_image_generate.py` | Seedream Image Generation Skill for Echo-Agent Uses Volcano Engine Seedream API to generate images from text prompts. |
| `skill-creator/eval-viewer/generate_review.py` | Generate and serve a review page for eval results. |
| `skill-creator/scripts/aggregate_benchmark.py` | Aggregate individual run results into benchmark summary statistics. |
| `skill-creator/scripts/generate_report.py` | Generate an HTML report from run_loop.py output. |
| `skill-creator/scripts/improve_description.py` | Improve a skill description based on eval results. |
| `skill-creator/scripts/package_skill.py` | Skill Packager - Creates a distributable .skill file of a skill folder |
| `skill-creator/scripts/quick_validate.py` | Quick validation script for skills - minimal version |
| `skill-creator/scripts/run_eval.py` | Run trigger evaluation for a skill description. |
| `skill-creator/scripts/run_loop.py` | Run the eval + improve loop until all pass or max iterations reached. |
| `skill-creator/scripts/utils.py` | Shared utilities for skill-creator scripts. |

## Key classes & functions

> AST 自动提取 · 仅列公开顶层 class / function · 签名与真实代码一致。

### `auto-stat-test/scripts/statistical_test_suite.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| func | `def load_data(path)` |  |
| func | `def is_categorical(series, max_unique_abs, max_unique_ratio)` |  |
| func | `def check_normality(data, alpha)` |  |
| func | `def check_equal_variance(groups, alpha)` |  |
| func | `def round_p(p)` |  |
| func | `def format_p_text(p)` |  |
| func | `def significance_label(p)` |  |
| func | `def run_independent_ttest(groups, group_names, alpha)` |  |
| func | `def run_mann_whitney(groups, group_names)` |  |
| func | `def run_one_way_anova(groups, group_names)` |  |
| func | `def run_kruskal_wallis(groups, group_names)` |  |
| func | `def run_chi_square(df, col1, col2)` |  |
| func | `def run_paired_ttest(d1, d2, name1, name2)` |  |
| func | `def run_wilcoxon(d1, d2, name1, name2)` |  |
| func | `def interpret(result, alpha)` |  |
| func | `def auto_select_and_run(df, group_col, value_col, col1, col2, paired, force_test, alpha)` |  |
| func | `def main()` |  |

### `cn-finance-data/scripts/api_client.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class TushareAPI` | Tushare API 客户端 |

### `code-vuln-audit/scripts/security_scan.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| func | `def shannon_entropy(data)` | Calculate Shannon entropy of a string. |
| class | `class Finding` |  |
| func | `def walk_files(root, exclude_dirs, max_file_kb)` | Yield (path, relative_path) for scannable text files. |
| func | `def read_lines(fpath)` | Read file lines, returning empty list for binary/undecodable files. |
| func | `def scan_npm(project_dir)` | Run npm audit and return findings. |
| func | `def scan_pip(project_dir)` | Run pip-audit and return findings. |
| func | `def scan_secrets(root, exclude_dirs, max_file_kb)` | Scan for hardcoded secrets using regex + entropy. |
| func | `def scan_owasp(root, exclude_dirs, max_file_kb)` | Scan for OWASP security anti-patterns. |
| func | `def format_text(target, modules, findings)` | Format findings as human-readable text. |
| func | `def format_json(target, modules, findings)` | Format findings as JSON. |
| func | `def deduplicate(findings)` | Remove duplicate findings (same file + line + name). |
| func | `def build_parser()` |  |
| func | `def main()` |  |

### `pricing-advisor/scripts/pricing_modeler.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| func | `def calculate_arpu(plans)` |  |
| func | `def project_revenue_at_price(base_customers, base_arpu, new_arpu, new_customers_monthly, churn_rate, months)` | Project MRR over N months at a new ARPU, assuming some churn from price change. |
| func | `def recommend_tier_structure(plans, competitor_prices, cogs, target_margin_pct)` | Recommend Good-Better-Best tier structure based on current state and competitors. |
| func | `def elasticity_estimate(trial_to_paid_pct, current_arpu)` | Rough price elasticity signal based on conversion rate. |
| func | `def print_report(result, inputs)` |  |
| func | `def main()` |  |

### `seedance-video-generate/scripts/seedance_video_generate.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class SeedanceConfig` | Configuration for Seedance API. |
| class | `class SeedanceVideoGenerator` | Generator for Seedance videos. |
| func | `def generate_video(prompt, image_path, duration, resolution, style, motion_strength, seed, fps, output_dir, api_key)` | Generate video using Seedance API. |
| func | `def extend_video(video_path, prompt, extend_duration, output_dir, api_key)` | Extend existing video using Seedance API. |

### `seedream-image-generate/scripts/seedream_image_generate.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class SeedreamConfig` | Configuration for Seedream API. |
| class | `class SeedreamImageGenerator` | Generator for Seedream images. |
| func | `def generate_image(prompt, width, height, ratio, style, seed, negative_prompt, num_images, output_dir, api_key)` | Generate image using Seedream API. |

### `skill-creator/eval-viewer/generate_review.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| func | `def get_mime_type(path)` |  |
| func | `def find_runs(workspace)` | Recursively find directories that contain an outputs/ subdirectory. |
| func | `def build_run(root, run_dir)` | Build a run dict with prompt, outputs, and grading data. |
| func | `def embed_file(path)` | Read a file and return an embedded representation. |
| func | `def load_previous_iteration(workspace)` | Load previous iteration's feedback and outputs. |
| func | `def generate_html(runs, skill_name, previous, benchmark)` | Generate the complete standalone HTML page with embedded data. |
| class | `class ReviewHandler(BaseHTTPRequestHandler)` | Serves the review HTML and handles feedback saves. |
| func | `def main()` |  |

### `skill-creator/scripts/aggregate_benchmark.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| func | `def calculate_stats(values)` | Calculate mean, stddev, min, max for a list of values. |
| func | `def load_run_results(benchmark_dir)` | Load all run results from a benchmark directory. |
| func | `def aggregate_results(results)` | Aggregate run results into summary statistics. |
| func | `def generate_benchmark(benchmark_dir, skill_name, skill_path)` | Generate complete benchmark.json from run results. |
| func | `def generate_markdown(benchmark)` | Generate human-readable benchmark.md from benchmark data. |
| func | `def main()` |  |

### `skill-creator/scripts/generate_report.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| func | `def generate_html(data, auto_refresh, skill_name)` | Generate HTML report from loop output data. If auto_refresh is True, adds a meta refresh tag. |
| func | `def main()` |  |

### `skill-creator/scripts/improve_description.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| func | `def improve_description(skill_name, skill_content, current_description, eval_results, history, model, test_results, log_dir, iteration)` | Call Claude to improve the description based on eval results. |
| func | `def main()` |  |

### `skill-creator/scripts/package_skill.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| func | `def should_exclude(rel_path)` | Check if a path should be excluded from packaging. |
| func | `def package_skill(skill_path, output_dir)` | Package a skill folder into a .skill file. |
| func | `def main()` |  |

### `skill-creator/scripts/quick_validate.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| func | `def validate_skill(skill_path)` | Basic validation of a skill |

### `skill-creator/scripts/run_eval.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| func | `def find_project_root()` | Find the project root by walking up from cwd looking for .claude/. |
| func | `def run_single_query(query, skill_name, skill_description, timeout, project_root, model)` | Run a single query and return whether the skill was triggered. |
| func | `def run_eval(eval_set, skill_name, description, num_workers, timeout, project_root, runs_per_query, trigger_threshold, model)` | Run the full eval set and return results. |
| func | `def main()` |  |

### `skill-creator/scripts/run_loop.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| func | `def split_eval_set(eval_set, holdout, seed)` | Split eval set into train and test sets, stratified by should_trigger. |
| func | `def run_loop(eval_set, skill_path, description_override, num_workers, timeout, max_iterations, runs_per_query, trigger_threshold, holdout, model, verbose, live_report_path, log_dir)` | Run the eval + improvement loop. |
| func | `def main()` |  |

### `skill-creator/scripts/utils.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| func | `def parse_skill_md(skill_path)` | Parse a SKILL.md file, returning (name, description, full_content). |


## Who imports this

**11** file(s) reference this package:

- **`runtime/core/`** · 3 file(s)
  - `runtime/core/cerebrum/_react_context_helpers.py`
  - `runtime/core/cerebrum/_react_execution_dispatch.py`
  - `runtime/core/cerebrum/react_parallel_dispatch.py`
- **`runtime/execution/`** · 4 file(s)
  - `runtime/execution/misc/capability_catalog.py`
  - `runtime/execution/misc/capability_permissions.py`
  - `runtime/execution/swarm/drive.py`
  - `runtime/execution/tool_engine/executor.py`
- **`runtime/platform/`** · 2 file(s)
  - `runtime/platform/config/builder.py`
  - `runtime/platform/ui/health_router.py`
- **`runtime/sensing/`** · 2 file(s)
  - `runtime/sensing/gateway/_agents_endpoints_system.py`
  - `runtime/sensing/gateway/_meta_skill_metadata.py`

