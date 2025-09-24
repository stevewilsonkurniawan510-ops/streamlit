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

import os
import tempfile
from pathlib import Path

import pytest

from streamlit.components.v2.component_manager import BidiComponentManager
from streamlit.components.v2.component_registry import BidiComponentDefinition
from streamlit.components.v2.manifest_scanner import ComponentManifest


def test_get_component_path_prefers_asset_dir_when_present() -> None:
    """Manager should return manifest-declared asset_dir over registry paths."""
    manager = BidiComponentManager()

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)

        # Create a registry-backed JS file in dir A
        dir_a = tmp_path / "dir_a"
        dir_a.mkdir(parents=True)
        js_a = dir_a / "index.js"
        js_a.write_text("console.log('A');")

        # Register component with file-backed JS path (registry fallback)
        comp_name = "pkg.slider"
        manager.register(
            BidiComponentDefinition(
                name=comp_name,
                js=str(js_a),
            )
        )

        # Prepare manifest-declared asset_dir (dir B)
        package_root = tmp_path / "package"
        assets_b = package_root / "assets"
        assets_b.mkdir(parents=True)
        (assets_b / "index.js").write_text("console.log('B');")

        manifest = ComponentManifest(
            name="pkg",
            version="0.0.1",
            components=[{"name": "slider", "asset_dir": "assets"}],
        )

        # Register manifest; manager should now prefer asset_dir
        manager.register_from_manifest(manifest, package_root)

        got = manager.get_component_path(comp_name)
        assert got is not None
        assert os.path.realpath(got) == os.path.realpath(str(assets_b))


def test_register_from_manifest_requires_asset_dir_even_if_html_present() -> None:
    """Registering a component without asset_dir should raise, even with html."""
    manager = BidiComponentManager()

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)

        package_root = tmp_path / "package"
        package_root.mkdir(parents=True)

        manifest = ComponentManifest(
            name="pkg",
            version="0.0.1",
            components=[{"name": "no_assets", "html": "<div></div>"}],
        )

        with pytest.raises(ValueError, match="must declare an asset_dir"):
            manager.register_from_manifest(manifest, package_root)


def test_on_components_changed_preserves_html_and_resolves_assets(
    tmp_path: Path,
) -> None:
    """Manager recompute should preserve html and resolve css/js under asset_dir.

    Verifies the single typed update path via registry.update_component.
    """
    manager = BidiComponentManager()

    # Prepare manifest with asset_dir
    package_root = tmp_path / "package"
    assets = package_root / "assets"
    (assets / "js").mkdir(parents=True)
    (assets / "style.css").write_text(".x { color: red; }")
    (assets / "js" / "main.js").write_text("console.log('ok');")

    manifest = ComponentManifest(
        name="pkg",
        version="0.0.1",
        components=[{"name": "slider", "asset_dir": "assets"}],
    )
    manager.register_from_manifest(manifest, package_root)

    comp_name = "pkg.slider"

    # Existing definition with html to be preserved during recompute
    manager.register(BidiComponentDefinition(name=comp_name, html="<p>orig</p>"))

    # Record API inputs as globs resolved relative to asset_dir
    manager.record_api_inputs(
        comp_name,
        caller_dir=str(tmp_path),
        css="*.css",
        js="js/*.js",
    )

    # Trigger change handler for this component
    manager._on_components_changed([comp_name])

    # Validate outcome in the registry
    d = manager.get(comp_name)
    assert d is not None
    assert d.html_content == "<p>orig</p>"
    # File-backed entries expose asset-dir-relative URLs
    assert d.css_url == "style.css"
    assert d.js_url == "js/main.js"
    # Content properties must be None for file-backed entries
    assert d.css_content is None
    assert d.js_content is None
