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
import threading
from typing import TYPE_CHECKING, Any, Callable, Final

from streamlit.logger import get_logger

if TYPE_CHECKING:
    from pathlib import Path


_LOGGER: Final = get_logger(__name__)


class ComponentFileWatcher:
    """Handles file watching for component glob patterns."""

    def __init__(self, component_update_callback: Callable[[list[str]], None]) -> None:
        """Initialize the file watcher.

        Parameters
        ----------
        component_update_callback : Callable[[list[str]], None]
            Callback function to call when components under watched roots change.
            Signature: (affected_component_names)
        """
        self._component_update_callback = component_update_callback
        self._lock = threading.Lock()

        # File watching state
        self._watched_directories: dict[
            str, list[str]
        ] = {}  # directory -> component_names
        self._path_watchers: list[Any] = []  # Store actual watcher instances
        self._watching_active = False

        # Store asset roots to watch: component_name -> asset_root
        self._asset_watch_roots: dict[str, Path] = {}

        # Default noisy directories to ignore in callbacks
        self._ignored_dirs: tuple[str, ...] = (
            "node_modules",
            ".git",
            "__pycache__",
            ".cache",
            "coverage",
            "venv",
        )

    @property
    def is_watching_active(self) -> bool:
        """Check if file watching is currently active.

        Returns
        -------
        bool
            True if file watching is active, False otherwise
        """
        return self._watching_active

    def start_file_watching(self, asset_watch_roots: dict[str, Path]) -> None:
        """Start file watching for asset roots.

        Parameters
        ----------
        asset_watch_roots : dict[str, Path]
            Dictionary mapping component names to their asset root directories
        """
        self._asset_watch_roots = asset_watch_roots.copy()
        self._start_file_watching()

    def stop_file_watching(self) -> None:
        """Stop file watching and clean up watchers."""
        with self._lock:
            if not self._watching_active:
                return

            # Close all path watchers
            for watcher in self._path_watchers:
                try:
                    watcher.close()
                except Exception:  # noqa: PERF203
                    _LOGGER.exception("Failed to close path watcher")

            self._path_watchers.clear()
            self._watched_directories.clear()
            # Also clear asset root references to avoid stale state retention
            self._asset_watch_roots.clear()
            self._watching_active = False
            _LOGGER.debug("Stopped file watching for component registry")

    def _start_file_watching(self) -> None:
        """Internal method to start file watching."""
        with self._lock:
            if self._watching_active:
                return

            if not self._asset_watch_roots:
                _LOGGER.debug("No asset roots to watch")
                return

            try:
                from streamlit.watcher.path_watcher import (
                    get_default_path_watcher_class,
                )

                path_watcher_class = get_default_path_watcher_class()

                # Collect directories to watch (dedupe)
                directories_to_watch: dict[str, list[str]] = {}
                for comp_name, root in self._asset_watch_roots.items():
                    directory = str(root.resolve())
                    if directory not in directories_to_watch:
                        directories_to_watch[directory] = []
                    if comp_name not in directories_to_watch[directory]:
                        directories_to_watch[directory].append(comp_name)

                # Setup watchers (directories only)
                self._setup_directory_watchers(path_watcher_class, directories_to_watch)

                self._watching_active = True
                _LOGGER.debug(
                    "Started file watching for %d directories",
                    len(self._watched_directories),
                )

            except ImportError:
                _LOGGER.warning("File watching not available: watchdog not installed")
            except Exception as e:
                _LOGGER.warning("Failed to start file watching: %s", e)

    def _setup_directory_watchers(
        self, path_watcher_class: type, directories_to_watch: dict[str, list[str]]
    ) -> None:
        """Setup watchers for directories containing glob patterns.

        Parameters
        ----------
        path_watcher_class : type
            The path watcher class to use
        directories_to_watch : dict[str, list[str]]
            Directories to watch and their associated component names
        """
        for directory, component_names in directories_to_watch.items():
            try:
                # Create a closure to capture the component names for this directory
                def create_callback(comps: list[str]) -> Callable[[str], None]:
                    def callback(changed_path: str) -> None:
                        if self._is_in_ignored_directory(changed_path):
                            _LOGGER.debug(
                                "Ignoring change in noisy directory: %s", changed_path
                            )
                            return
                        _LOGGER.debug(
                            "Directory change detected: %s, checking components: %s",
                            changed_path,
                            comps,
                        )
                        self._handle_component_change(comps)

                    return callback

                # Use a glob pattern that matches all files to let Streamlit's
                # watcher handle MD5 calculation and change detection
                watcher = path_watcher_class(
                    directory,
                    create_callback(component_names),
                    glob_pattern="**/*",
                    allow_nonexistent=False,
                )
                self._path_watchers.append(watcher)
                self._watched_directories[directory] = component_names
                _LOGGER.debug(
                    "Started watching directory %s for components: %s",
                    directory,
                    component_names,
                )
            except Exception:  # noqa: PERF203
                _LOGGER.exception("Failed to start watching directory %s", directory)

    def _handle_component_change(self, affected_components: list[str]) -> None:
        """Handle component changes for both directory and file events.

        Parameters
        ----------
        affected_components : list[str]
            List of component names affected by the change
        """
        if not self._watching_active:
            return

        # Notify manager to handle re-resolution based on recorded API inputs
        try:
            self._component_update_callback(affected_components)
        except Exception:
            # Never allow exceptions from user callbacks to break watcher loops
            _LOGGER.exception("Component update callback raised")

    def _is_in_ignored_directory(self, changed_path: str) -> bool:
        """Return True if the changed path is inside an ignored directory.

        Parameters
        ----------
        changed_path : str
            The filesystem path that triggered the change event.

        Returns
        -------
        bool
            True if the path is located inside one of the ignored directories,
            False otherwise.
        """
        try:
            abs_path = os.path.realpath(changed_path)
            parts = set(abs_path.split(os.sep))
            return any(ignored in parts for ignored in self._ignored_dirs)
        except Exception:
            return False
