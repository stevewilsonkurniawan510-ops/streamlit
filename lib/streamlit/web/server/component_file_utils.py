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

from __future__ import annotations

import mimetypes
import os
from typing import Final

_OCTET_STREAM: Final[str] = "application/octet-stream"


def build_safe_abspath(component_root: str, relative_url_path: str) -> str | None:
    """Return a safe absolute path inside ``component_root`` or ``None`` if forbidden.

    Resolves symlinks and normalizes paths to prevent directory traversal.
    """
    root_real = os.path.realpath(component_root)
    candidate = os.path.normpath(os.path.join(root_real, relative_url_path))
    candidate_real = os.path.realpath(candidate)

    try:
        # Ensure the candidate stays within the real component root
        if os.path.commonpath([root_real, candidate_real]) != root_real:
            return None
    except ValueError:
        # On some platforms, commonpath can raise if drives differ; treat as forbidden.
        return None

    return candidate_real


def guess_content_type(abspath: str) -> str:
    """Return Content-Type for ``abspath`` consistent with Tornado's StaticFileHandler."""
    mime_type, encoding = mimetypes.guess_type(abspath)
    if encoding == "gzip":
        return "application/gzip"
    if encoding is not None:
        return _OCTET_STREAM
    if mime_type is not None:
        return mime_type
    return _OCTET_STREAM
