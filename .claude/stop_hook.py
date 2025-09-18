#!/usr/bin/env python3
# Copyright (c) Streamlit Inc. (2018-2022) Snowflake Inc. (2022-2025)
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Stop hook for Claude Code in Streamlit repository.
Runs quality checks before allowing Claude to complete tasks.
Optimized to only check modified files for faster execution.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Final

# Constants
# Total hook timeout is 90s (set in settings.json)
# Optimized to check only modified files for faster execution
PYTHON_COMMAND_TIMEOUT: Final = 10  # Python checks are fast
FRONTEND_COMMAND_TIMEOUT: Final = 30  # Reduced timeout for file-specific checks
SEPARATOR: Final = "=" * 60
MAX_ERROR_LINES: Final = 20  # Maximum number of error lines to display

# Keywords for filtering relevant error lines
PYTHON_ERROR_KEYWORDS: Final = ["error", "would reformat", "failed", "***", ".py:"]
FRONTEND_ERROR_KEYWORDS: Final = [
    "error",
    "failed",
    "***",
    ".ts:",
    ".tsx:",
    ".js:",
    ".jsx:",
]
NODE_MODULES_KEYWORDS: Final = ["node_modules", "findpackagelocation"]


def run_command(
    cmd: list[str], timeout: int = 10, cwd: str | None = None
) -> tuple[int, str, str]:
    """Run a command and return exit code, stdout, and stderr."""
    try:
        result = subprocess.run(  # noqa: S603
            cmd,
            check=False,
            capture_output=True,
            text=True,
            cwd=cwd,
            timeout=timeout,
        )
        return result.returncode, result.stdout, result.stderr
    except subprocess.TimeoutExpired:
        return 1, "", f"Command timed out after {timeout}s: {' '.join(cmd)}"
    except Exception as e:
        return 1, "", str(e)


def filter_relevant_lines(output: str, keywords: list[str]) -> list[str]:
    """Filter output lines that contain any of the specified keywords."""
    lines = output.split("\n")
    return [
        line for line in lines if any(keyword in line.lower() for keyword in keywords)
    ]


def format_check_result(
    exit_code: int,
    stdout: str,
    stderr: str,
    check_name: str,
    error_keywords: list[str],
    make_command: str,
) -> str | None:
    """
    Format the result of a quality check command.

    Returns None if check passed, error message string if failed.
    """
    if exit_code == 0:
        return None

    output = (stdout + "\n" + stderr).strip()
    relevant_lines = filter_relevant_lines(output, error_keywords)

    if relevant_lines:
        # Check for specific error types
        if "would reformat" in output.lower():
            return f"{check_name} formatting issues found:\n" + "\n".join(
                relevant_lines
            )
        return f"{check_name} failed:\n" + "\n".join(relevant_lines)

    return f"{check_name} failed (run '{make_command}' for details)"


def get_modified_files() -> tuple[list[str], list[str]]:
    """Get lists of modified Python and TypeScript/JavaScript files.

    Returns
    -------
        Tuple of (python_files, frontend_files)
    """
    # Get modified files compared to develop branch
    exit_code, stdout, _ = run_command(
        ["git", "diff", "--name-only", "develop", "HEAD"]
    )

    if exit_code != 0:
        # Fallback to checking staged and unstaged changes
        exit_code, stdout, _ = run_command(["git", "diff", "--name-only", "--cached"])
        exit_code2, stdout2, _ = run_command(["git", "diff", "--name-only"])
        if exit_code != 0 or exit_code2 != 0:
            print(  # noqa: T201
                "Error: Failed to get modified files from git (both staged and unstaged).",
                file=sys.stderr,
            )
            return [], []
        stdout = stdout + "\n" + stdout2

    if not stdout.strip():
        return [], []

    files = stdout.strip().split("\n")
    python_files = []
    frontend_files = []

    for file in files:
        if not file:
            continue
        # Check if file exists (might be deleted)
        if not Path(file).exists():
            continue

        if file.endswith(".py"):
            python_files.append(file)
        elif any(file.endswith(ext) for ext in [".ts", ".tsx", ".js", ".jsx"]):
            frontend_files.append(file)

    return python_files, frontend_files


def check_python_quality() -> list[str]:
    """Run Python linting and type checking on modified files."""
    python_files, _ = get_modified_files()

    # Skip if no Python files modified
    if not python_files:
        return []

    issues = []

    # Python linting with ruff (includes formatting check)
    # Run ruff directly on specific files for faster execution
    exit_code, stdout, stderr = run_command(
        ["ruff", "check", *python_files], timeout=PYTHON_COMMAND_TIMEOUT
    )
    if exit_code != 0:
        output = (stdout + "\n" + stderr).strip()
        relevant_lines = filter_relevant_lines(output, PYTHON_ERROR_KEYWORDS)
        if relevant_lines:
            issues.append("Python linting issues found:\n" + "\n".join(relevant_lines))

    # Check formatting with ruff format
    exit_code, stdout, stderr = run_command(
        ["ruff", "format", "--check", *python_files], timeout=PYTHON_COMMAND_TIMEOUT
    )
    if exit_code != 0:
        output = (stdout + "\n" + stderr).strip()
        if "would reformat" in output.lower():
            issues.append(f"Python formatting issues found:\n{output}")

    # Python type checking with mypy on specific files
    exit_code, stdout, stderr = run_command(
        ["mypy", *python_files], timeout=PYTHON_COMMAND_TIMEOUT
    )
    if exit_code != 0:
        output = (stdout + "\n" + stderr).strip()
        relevant_lines = filter_relevant_lines(output, PYTHON_ERROR_KEYWORDS)
        if relevant_lines:
            issues.append("Python type checking failed:\n" + "\n".join(relevant_lines))

    return issues


def check_frontend_quality() -> list[str]:
    """Run frontend linting and type checking on modified files."""
    _, frontend_files = get_modified_files()

    # Skip if no frontend files modified
    if not frontend_files:
        return []

    issues = []

    # Check if node_modules exists
    if not Path("frontend/node_modules").exists():
        print(  # noqa: T201
            "⚠️  Skipping frontend checks - node_modules not installed",
            file=sys.stderr,
        )
        return []

    # Run ESLint on specific files
    # Convert paths to be relative to frontend directory
    frontend_relative_files = [
        file.removeprefix("frontend/")
        for file in frontend_files
        if file.startswith("frontend/")
    ]

    if frontend_relative_files:
        # ESLint for linting - use npx to run the binary directly
        exit_code, stdout, stderr = run_command(
            ["npx", "eslint", "--max-warnings", "0", *frontend_relative_files],
            timeout=FRONTEND_COMMAND_TIMEOUT,
            cwd="frontend",
        )
        if exit_code != 0:
            output = (stdout + "\n" + stderr).strip()
            relevant_lines = filter_relevant_lines(output, FRONTEND_ERROR_KEYWORDS)
            if relevant_lines:
                issues.append(
                    "Frontend linting issues found:\n" + "\n".join(relevant_lines)
                )

        # Prettier for formatting check - use npx to run the binary directly
        exit_code, stdout, stderr = run_command(
            ["npx", "prettier", "--check", *frontend_relative_files],
            timeout=FRONTEND_COMMAND_TIMEOUT,
            cwd="frontend",
        )
        if exit_code != 0:
            output = (stdout + "\n" + stderr).strip()
            if "would" in output.lower() or "formatting" in output.lower():
                issues.append(f"Frontend formatting issues found:\n{output}")

        # TypeScript type checking
        # For type checking, we still need to run the full check as tsc doesn't support file-specific checks well
        # But we can use a shorter timeout since we know there are changes
        exit_code, stdout, stderr = run_command(
            ["yarn", "workspaces", "foreach", "--all", "run", "typecheck"],
            timeout=FRONTEND_COMMAND_TIMEOUT,
            cwd="frontend",
        )
        if exit_code != 0:
            output = (stdout + "\n" + stderr).strip()
            # Filter to only show errors related to our modified files
            relevant_lines = []
            for line in output.split("\n"):
                # Check if line contains any of our modified files as exact path components
                line_lower = line.lower()
                is_relevant = "error" in line_lower
                if not is_relevant:
                    for file in frontend_relative_files:
                        # Use more precise matching to avoid false positives
                        # Check for file path with separators or at line boundaries
                        if (
                            f"/{file}" in line
                            or line.startswith(file)
                            or f" {file}" in line
                            or f"{file}:" in line
                        ):
                            is_relevant = True
                            break
                if is_relevant:
                    relevant_lines.append(line)
            if relevant_lines:
                issues.append(
                    "Frontend type checking failed:\n"
                    + "\n".join(relevant_lines[:MAX_ERROR_LINES])
                )  # Limit output

    return issues


def print_results(issues: list[str]) -> None:
    """Print the results of all quality checks to stderr."""
    if issues:
        print(  # noqa: T201
            "❌ Quality checks failed! Please fix the following issues:",
            file=sys.stderr,
        )
        print(SEPARATOR, file=sys.stderr)  # noqa: T201

        for issue in issues:
            print(f"\n{issue}", file=sys.stderr)  # noqa: T201

        print(SEPARATOR, file=sys.stderr)  # noqa: T201
        print(  # noqa: T201
            "\n💡 Run 'make autofix' to automatically fix formatting issues",
            file=sys.stderr,
        )
    else:
        print("✅ All quality checks passed!", file=sys.stderr)  # noqa: T201


def main() -> None:
    """Main entry point for the stop hook."""
    # Check if stop_hook_active is set to prevent infinite loops
    stdin_input = sys.stdin.read() if not sys.stdin.isatty() else "{}"

    try:
        hook_input = json.loads(stdin_input)
    except json.JSONDecodeError:
        hook_input = {}

    if hook_input.get("stop_hook_active"):
        # Already in a stop hook, allow normal stoppage
        sys.exit(0)

    # Get modified files first to determine what to check
    python_files, frontend_files = get_modified_files()

    if not python_files and not frontend_files:
        print(  # noqa: T201
            "✅ No modified Python or TypeScript/JavaScript files to check!",
            file=sys.stderr,
        )
        sys.exit(0)

    # Print what we're checking
    print(  # noqa: T201
        f"🔍 Checking {len(python_files)} Python and {len(frontend_files)} frontend files...",
        file=sys.stderr,
    )

    # Run quality checks only on modified files
    all_issues = []
    if python_files:
        all_issues.extend(check_python_quality())
    if frontend_files:
        all_issues.extend(check_frontend_quality())

    # Print results and exit with appropriate code
    print_results(all_issues)
    sys.exit(2 if all_issues else 0)  # Exit code 2 blocks stoppage


if __name__ == "__main__":
    main()
