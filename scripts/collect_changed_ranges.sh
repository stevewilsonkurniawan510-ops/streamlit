#!/usr/bin/env bash

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

set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
base_remote="${GITHUB_BASE_REF:-develop}"

# Best-effort fetch of the base ref
git fetch origin "$base_remote" --depth=1 >/dev/null 2>&1 || true

# Optional mode: print absolute changed paths only (one per line)
if [ "${1-}" = "--paths-only" ]; then
  {
    git diff --name-only "origin/${base_remote}"...HEAD || true
    git diff --name-only --cached || true
    git diff --name-only || true
    git ls-files --others --exclude-standard || true
  } | sort -u | awk -v root="$repo_root" 'NF{ printf "%s/%s\n", root, $0 }'
  exit 0
fi

emit_hunks_from_diff() {
  awk -v repo_root="$repo_root" '
    function print_obj() {
      if (count > 0 && path != "") {
        printf "{\"path\":\"%s/%s\",\"ranges\":[", repo_root, path
        for (i=0; i<count; i++) {
          if (i>0) printf ","
          printf "{\"start\":%d,\"end\":%d}", starts[i], ends[i]
        }
        printf "]}\n"
      }
    }
    BEGIN { path=""; count=0 }
    /^\+\+\+ / {
      newfile=$2
      if (newfile == "/dev/null") { next }
      sub(/^a\//, "", newfile); sub(/^b\//, "", newfile)
      if (path != "" && newfile != path) { print_obj(); count=0 }
      path=newfile; next
    }
    /^@@ / {
      newhunk=$3; sub(/^\+/, "", newhunk)
      n = split(newhunk, parts, ",")
      start = parts[1] + 0
      len = (n >= 2 ? parts[2] + 0 : 1)
      if (len > 0 && path != "") { end = start + len - 1; starts[count]=start; ends[count]=end; count++ }
      next
    }
    END { print_obj() }
  '
}

emit_untracked() {
  local f="$1"
  local abs="$repo_root/$f"
  if [ -f "$abs" ]; then
    lines=$(wc -l < "$abs" | awk '{print $1}')
    if [ "$lines" -gt 0 ]; then
      printf '{"path":"%s","ranges":[{"start":1,"end":%d}]}' "$abs" "$lines"
      printf '\n'
    fi
  fi
}

# 1) Committed changes vs merge-base with origin/${base_remote}
git diff --no-color -U0 "origin/${base_remote}"...HEAD | emit_hunks_from_diff || true

# 2) Staged but uncommitted changes vs HEAD
git diff --no-color -U0 --cached | emit_hunks_from_diff || true

# 3) Unstaged working tree changes vs index
git diff --no-color -U0 | emit_hunks_from_diff || true

# 4) Untracked new files (entire file range)
git ls-files --others --exclude-standard | while IFS= read -r f; do
  emit_untracked "$f"
done
