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

"""Tests for the BidiComponentManager in the Runtime."""

import unittest
from unittest.mock import MagicMock

from streamlit.components.v2.component_manager import BidiComponentManager
from streamlit.components.v2.component_registry import (
    BidiComponentDefinition,
)
from streamlit.runtime.runtime import Runtime, RuntimeConfig


class BidiComponentManagerTest(unittest.TestCase):
    """Test that the BidiComponentManager is properly initialized in the runtime."""

    def tearDown(self) -> None:
        # Clear the singleton instance after each test
        Runtime._instance = None

    def test_bidi_component_registry_initialization(self):
        """Test that the BidiComponentManager is properly initialized."""
        # Create a mock config with minimum required parameters
        config = RuntimeConfig(
            script_path="test_path",
            command_line=None,
            media_file_storage=MagicMock(),
            uploaded_file_manager=MagicMock(),
        )

        # Initialize the runtime
        runtime = Runtime(config)

        # Verify that the BidiComponentManager is initialized
        assert runtime.bidi_component_registry is not None
        assert isinstance(runtime.bidi_component_registry, BidiComponentManager)

    def test_custom_bidi_component_registry(self):
        """Test that a custom BidiComponentManager can be provided to the runtime."""
        # Create a custom component manager
        custom_component_manager = BidiComponentManager()
        custom_component_manager.register(
            BidiComponentDefinition(
                name="test_component",
                html="<div>Test</div>",
            )
        )

        # Create a mock config with our custom registry
        config = RuntimeConfig(
            script_path="test_path",
            command_line=None,
            media_file_storage=MagicMock(),
            uploaded_file_manager=MagicMock(),
            bidi_component_registry=custom_component_manager,
        )

        # Initialize the runtime
        runtime = Runtime(config)

        # Verify that our custom component manager is used
        assert runtime.bidi_component_registry is custom_component_manager
        assert runtime.bidi_component_registry.get("test_component") is not None
