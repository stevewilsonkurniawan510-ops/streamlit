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

import tempfile
from pathlib import Path
from unittest.mock import Mock, patch

import pytest

from streamlit.components.v2.component_file_watcher import ComponentFileWatcher


@pytest.fixture
def temp_component_files():
    """Create temporary directory structure with component files for testing."""
    temp_dir = tempfile.TemporaryDirectory()
    temp_path = Path(temp_dir.name)

    # Create directory structure
    js_dir = temp_path / "js"
    css_dir = temp_path / "css"
    js_dir.mkdir()
    css_dir.mkdir()

    # Create test files
    js_file = js_dir / "component.js"
    js_file.write_text("console.log('original');")

    css_file = css_dir / "styles.css"
    css_file.write_text(".test { color: red; }")

    # Create glob pattern files
    glob_js_file = js_dir / "component-v1.0.js"
    glob_js_file.write_text("console.log('glob v1');")

    glob_css_file = css_dir / "styles-v1.0.css"
    glob_css_file.write_text(".glob { color: blue; }")

    yield {
        "temp_dir": temp_path,
        "js_file": js_file,
        "css_file": css_file,
        "glob_js_file": glob_js_file,
        "glob_css_file": glob_css_file,
    }

    temp_dir.cleanup()


@pytest.fixture
def mock_callback():
    """Create a mock callback function."""
    return Mock()


@pytest.fixture
def file_watcher(mock_callback):
    """Create a ComponentFileWatcher instance with mock callback."""
    return ComponentFileWatcher(mock_callback)


def test_init(mock_callback):
    """Test initialization of ComponentFileWatcher."""
    watcher = ComponentFileWatcher(mock_callback)

    assert watcher._component_update_callback is mock_callback
    assert not watcher.is_watching_active
    assert watcher._watched_directories == {}
    assert watcher._path_watchers == []
    assert watcher._asset_watch_roots == {}


def test_start_file_watching_no_watchers(file_watcher):
    """Test starting file watching with no asset roots."""
    file_watcher.start_file_watching({})

    assert not file_watcher.is_watching_active


@pytest.mark.parametrize(
    ("roots_kind", "expected_watchers", "expected_dirs"),
    [
        ("single", 1, 1),
        ("multiple", 2, 2),
        ("shared", 1, 1),
    ],
)
def test_start_file_watching_various_roots(
    file_watcher,
    temp_component_files,
    roots_kind: str,
    expected_watchers: int,
    expected_dirs: int,
):
    """Start watching with different root configurations and verify watcher counts.

    Parameters
    ----------
    roots_kind
        One of ``single``, ``multiple``, or ``shared`` to setup asset roots.
    expected_watchers
        Expected number of watcher instances created.
    expected_dirs
        Expected number of watched directories recorded.
    """
    mock_watcher_instance = Mock()
    with patch(
        "streamlit.watcher.path_watcher.get_default_path_watcher_class",
        return_value=Mock(return_value=mock_watcher_instance),
    ):
        if roots_kind == "single":
            asset_roots = {"test.component": temp_component_files["temp_dir"]}
        elif roots_kind == "multiple":
            js_root = temp_component_files["temp_dir"] / "js"
            css_root = temp_component_files["temp_dir"] / "css"
            asset_roots = {
                "test.js_component": js_root,
                "test.css_component": css_root,
            }
        else:  # shared
            root = temp_component_files["temp_dir"]
            asset_roots = {"test.direct": root, "test.glob": root}

        file_watcher.start_file_watching(asset_roots)

        assert file_watcher.is_watching_active
        assert len(file_watcher._path_watchers) == expected_watchers
        assert len(file_watcher._watched_directories) == expected_dirs


def test_stop_file_watching(file_watcher):
    """Test stopping file watching."""
    # Mock some active watchers
    mock_watcher1 = Mock()
    mock_watcher2 = Mock()
    file_watcher._path_watchers = [mock_watcher1, mock_watcher2]
    file_watcher._watched_directories = {"dir1": ["comp1"]}
    # No file watchers in directory-only approach
    file_watcher._watching_active = True
    # Seed asset roots to verify cleanup
    file_watcher._asset_watch_roots = {"comp1": Path("/tmp")}

    file_watcher.stop_file_watching()

    # Should have closed all watchers
    mock_watcher1.close.assert_called_once()
    mock_watcher2.close.assert_called_once()

    # Should have cleared all state
    assert not file_watcher.is_watching_active
    assert file_watcher._path_watchers == []
    assert file_watcher._watched_directories == {}
    assert file_watcher._asset_watch_roots == {}


def test_handle_component_change_catches_callback_exceptions(file_watcher):
    """Ensure exceptions in the update callback are caught and logged."""
    file_watcher._watching_active = True

    # Replace the callback with a raising one
    def raising_callback(_components):
        raise RuntimeError("boom")

    file_watcher._component_update_callback = raising_callback

    # Patch logger.exception to ensure we log instead of propagating
    with patch("streamlit.components.v2.component_file_watcher._LOGGER") as logger_mock:
        # Should not raise
        file_watcher._handle_component_change(["test.component"])
        logger_mock.exception.assert_called_once()

    # Subsequent normal callbacks should still be invoked
    ok_mock = Mock()
    file_watcher._component_update_callback = ok_mock
    file_watcher._handle_component_change(["test.component"])
    ok_mock.assert_called_once_with(["test.component"])


def test_stop_file_watching_with_close_errors(file_watcher):
    """Test stopping file watching when watcher.close() raises an exception."""
    # Mock a watcher that raises an exception on close
    mock_watcher = Mock()
    mock_watcher.close.side_effect = Exception("Close failed")
    file_watcher._path_watchers = [mock_watcher]
    file_watcher._watching_active = True

    # Should not raise exception, just log it
    file_watcher.stop_file_watching()

    # Should still clean up state
    assert not file_watcher.is_watching_active
    assert file_watcher._path_watchers == []


@pytest.mark.parametrize("event_kind", ["directory", "file"])
def test_change_event_triggers_callback(
    file_watcher, temp_component_files, event_kind: str
):
    """Simulate a change event and ensure the update callback is invoked once."""
    file_watcher._watching_active = True
    file_watcher._handle_component_change(["test.component"])  # simulate both kinds
    file_watcher._component_update_callback.assert_called_once()


@pytest.mark.parametrize(
    "attr_name",
    [
        "_re_resolve_component_patterns",
        "_resolve_single_pattern",
        "_extract_html_content",
    ],
)
def test_no_legacy_helpers_present(file_watcher, attr_name: str):
    """Assert that removed legacy helpers are not present on the watcher."""
    assert not hasattr(file_watcher, attr_name)


@pytest.mark.parametrize("name_key", ["test.glob_recursive", "test.direct_parent"])
def test_directory_watchers_use_recursive_globs(
    file_watcher, temp_component_files, name_key: str
):
    """Ensure directory watchers are configured with recursive "**/*" globs."""
    mock_watcher_instance = Mock()
    watcher_class_mock = Mock(return_value=mock_watcher_instance)
    with patch(
        "streamlit.watcher.path_watcher.get_default_path_watcher_class",
        return_value=watcher_class_mock,
    ):
        file_watcher.start_file_watching({name_key: temp_component_files["temp_dir"]})

        assert watcher_class_mock.call_count == 1
        assert watcher_class_mock.call_args.kwargs.get("glob_pattern") == "**/*"


@pytest.mark.parametrize(
    "ignored_dir",
    ["node_modules", ".git", "__pycache__", ".cache", "coverage", "venv"],
)
def test_ignores_noisy_directories_in_callbacks(
    file_watcher, temp_component_files, ignored_dir: str
):
    """Change events under common noisy directories must be ignored in callbacks."""
    mock_watcher_instance = Mock()
    watcher_class_mock = Mock(return_value=mock_watcher_instance)
    with patch(
        "streamlit.watcher.path_watcher.get_default_path_watcher_class",
        return_value=watcher_class_mock,
    ):
        file_watcher.start_file_watching(
            {"test.glob_ignore": temp_component_files["temp_dir"]}
        )

        assert watcher_class_mock.call_count == 1
        cb = watcher_class_mock.call_args.args[1]
        noisy_path = str(
            (temp_component_files["temp_dir"] / "js" / ignored_dir / "dep.js").resolve()
        )

        cb(noisy_path)

        file_watcher._component_update_callback.assert_not_called()
