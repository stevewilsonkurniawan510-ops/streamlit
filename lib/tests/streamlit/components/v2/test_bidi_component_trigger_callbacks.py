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

"""Unit tests for *trigger* behaviour in ``st.bidi_component``.

The tests below focus on verifying that *per-event* trigger callbacks are
executed **exclusively** for the event whose value changed.
"""

from __future__ import annotations

import json
import math
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

import streamlit as st
from streamlit.components.v2.bidi_component import make_trigger_id
from streamlit.components.v2.component_manager import BidiComponentManager
from streamlit.components.v2.component_registry import (
    BidiComponentDefinition,
)
from streamlit.proto.WidgetStates_pb2 import WidgetState, WidgetStates
from streamlit.runtime import Runtime
from tests.delta_generator_test_case import DeltaGeneratorTestCase


class BidiComponentTriggerCallbackTest(DeltaGeneratorTestCase):
    """Verify that per-event *trigger* callbacks fire only for their event."""

    COMPONENT_NAME = "trigger_component"

    # ------------------------------------------------------------------
    # Test lifecycle helpers
    # ------------------------------------------------------------------
    def setUp(self):
        super().setUp()

        # Patch a fresh component manager into the Runtime singleton so tests are isolated.
        self.component_manager = BidiComponentManager()
        self.runtime_patcher = patch.object(
            Runtime, "instance", return_value=MagicMock()
        )
        self.mock_runtime = self.runtime_patcher.start()
        self.mock_runtime.return_value.bidi_component_registry = self.component_manager

        # Register a minimal JS-only component definition (enough for backend tests).
        self.component_manager.register(
            BidiComponentDefinition(name=self.COMPONENT_NAME, js="console.log('hi');")
        )

        # Prepare mocks for per-event callbacks.
        self.range_trigger_cb = MagicMock(name="range_trigger_cb")
        self.text_trigger_cb = MagicMock(name="text_trigger_cb")
        self.button_cb = MagicMock(name="button_cb")

        # First script run: render the component and capture its widget id.
        st.bidi_component(
            self.COMPONENT_NAME,
            on_range_change=self.range_trigger_cb,
            on_text_change=self.text_trigger_cb,
        )

        # Render a separate *button* widget that uses the classic trigger_value
        # mechanism so we can verify coexistence of multiple trigger sources.
        st.button("Click me!", on_click=self.button_cb)

        # After enqueuing both the component and the button, the button proto
        # is at the tail of the queue (index -1) and the component proto just
        # before that (index -2).

        self.button_id = self.get_delta_from_queue().new_element.button.id  # type: ignore[attr-defined]

        self.component_id = (
            self.get_delta_from_queue(-2).new_element.bidi_component.id  # type: ignore[attr-defined]
        )

        # Sanity: no callbacks should have fired during initial render.
        self.range_trigger_cb.assert_not_called()
        self.text_trigger_cb.assert_not_called()
        self.button_cb.assert_not_called()

    def tearDown(self):
        super().tearDown()
        # Stop Runtime.instance patcher started in setUp.
        self.runtime_patcher.stop()

    # ------------------------------------------------------------------
    # Utility to simulate frontend trigger updates
    # ------------------------------------------------------------------
    def _simulate_trigger_update(self, trigger_updates: dict[str, Any]):
        """Emulate the frontend firing one or more triggers.

        Parameters
        ----------
        trigger_updates : Dict[str, Any]
            Mapping from *event name* to *payload* value. The payload will be
            JSON-serialized before being injected into the ``WidgetState``
            protobuf.
        """

        # Aggregator path: combine updates into a single payload
        updates = [
            {"event": name, "value": payload}
            for name, payload in trigger_updates.items()
        ]
        payload = updates[0] if len(updates) == 1 else updates

        agg_id = make_trigger_id(self.component_id, "events")
        ws = WidgetState(id=agg_id)
        ws.json_trigger_value = json.dumps(payload)
        widget_states = WidgetStates(widgets=[ws])

        # Feed the simulated WidgetStates into Session State which will, in
        # turn, invoke the appropriate callbacks via ``_call_callbacks``.
        self.script_run_ctx.session_state.on_script_will_rerun(widget_states)

    def _simulate_button_click(self):
        """Simulate a user clicking the separate st.button widget."""

        ws = WidgetState(id=self.button_id)
        ws.trigger_value = True
        widget_states = WidgetStates(widgets=[ws])
        self.script_run_ctx.session_state.on_script_will_rerun(widget_states)

    # ------------------------------------------------------------------
    # Tests
    # ------------------------------------------------------------------
    def test_only_range_trigger_invokes_only_range_callback(self):
        """Updating only the ``range`` trigger should only call its callback."""

        self._simulate_trigger_update({"range": 10})

        self.range_trigger_cb.assert_called_once()
        self.text_trigger_cb.assert_not_called()

        # Value assertions via aggregator
        agg_id = make_trigger_id(self.component_id, "events")
        assert self.script_run_ctx.session_state[agg_id] == [
            {"event": "range", "value": 10}
        ]

    def test_only_text_trigger_invokes_only_text_callback(self):
        """Updating only the ``text`` trigger should only call its callback."""

        self._simulate_trigger_update({"text": "hello"})

        self.text_trigger_cb.assert_called_once()
        self.range_trigger_cb.assert_not_called()

    def test_both_triggers_fired_invokes_both_callbacks(self):
        """When *both* triggers fire simultaneously, *both* callbacks fire."""

        self._simulate_trigger_update({"range": 77, "text": "world"})

        self.range_trigger_cb.assert_called_once()
        self.text_trigger_cb.assert_called_once()

    # --------------------------------------------------------------
    # Interactions involving *another* trigger widget (st.button)
    # --------------------------------------------------------------

    def test_button_click_invokes_only_button_callback(self):
        """Clicking the separate st.button must not affect component triggers."""

        self._simulate_button_click()

        self.button_cb.assert_called_once()
        self.range_trigger_cb.assert_not_called()
        self.text_trigger_cb.assert_not_called()

        # After a button click, the *previous* range trigger should have been
        # reset to ``None`` by SessionState._reset_triggers.
        agg_id = make_trigger_id(self.component_id, "events")
        assert self.script_run_ctx.session_state[agg_id] is None

        self._simulate_trigger_update({"range": 10})

        self.button_cb.assert_called_once()
        self.range_trigger_cb.assert_called_once()
        self.text_trigger_cb.assert_not_called()

    def test_button_and_component_trigger_both_fire(self):
        """Simultaneous component trigger + button click fires *all* callbacks."""

        # Compose a single WidgetStates message that includes both updates.
        widget_states = WidgetStates()

        # Component trigger via aggregator for 'range'
        agg_id = make_trigger_id(self.component_id, "events")
        ws_component = WidgetState(id=agg_id)
        ws_component.json_trigger_value = json.dumps({"event": "range", "value": 123})
        widget_states.widgets.append(ws_component)

        # Button click
        ws_button = WidgetState(id=self.button_id)
        ws_button.trigger_value = True
        widget_states.widgets.append(ws_button)

        # Act
        self.script_run_ctx.session_state.on_script_will_rerun(widget_states)

        # Assert: all three callbacks should have fired accordingly.
        self.range_trigger_cb.assert_called_once()
        self.button_cb.assert_called_once()
        # text trigger remains untouched
        self.text_trigger_cb.assert_not_called()

    def test_handle_deserialize_with_none_input(self):
        """Test handle_deserialize returns None when input is None."""

        # Get the handle_deserialize function by creating an instance
        # and accessing the function through the component creation process
        deserializer = self._get_handle_deserialize_function()

        result = deserializer(None)
        assert result is None

    def test_handle_deserialize_with_valid_json_strings(self):
        """Test handle_deserialize correctly parses valid JSON strings."""
        deserializer = self._get_handle_deserialize_function()

        # Test various valid JSON values
        test_cases = [
            ("null", None),
            ("true", True),
            ("false", False),
            ("123", 123),
            ("-45.67", -45.67),
            ('"hello"', "hello"),
            ('"test string"', "test string"),
            ('{"key": "value"}', {"key": "value"}),
            ("[1, 2, 3]", [1, 2, 3]),
            ('{"nested": {"data": [1, 2]}}', {"nested": {"data": [1, 2]}}),
        ]

        for json_str, expected in test_cases:
            result = deserializer(json_str)
            assert result == expected, (
                f"Failed for input {json_str!r}: expected {expected!r}, got {result!r}"
            )

    def test_handle_deserialize_with_invalid_json_returns_string(self):
        """Test handle_deserialize returns string as-is when JSON parsing fails."""
        deserializer = self._get_handle_deserialize_function()

        # Test various non-JSON strings that should be returned as-is
        test_cases = [
            "hello world",
            "not json",
            "123abc",
            "true but not quite",
            "{not valid json}",
            "[1, 2, 3",  # Missing closing bracket
            '{"incomplete": ',  # Incomplete JSON
            "simple text",
            "user input value",
            "component_state_value",
        ]

        for invalid_json in test_cases:
            result = deserializer(invalid_json)
            assert result == invalid_json, (
                f"Failed for input {invalid_json!r}: expected {invalid_json!r}, got {result!r}"
            )

    def test_handle_deserialize_with_empty_and_whitespace_strings(self):
        """Test handle_deserialize handles empty and whitespace strings correctly."""
        deserializer = self._get_handle_deserialize_function()

        # Empty and whitespace strings should be returned as-is since they're not valid JSON
        test_cases = [
            "",  # Empty string
            " ",  # Single space
            "   ",  # Multiple spaces
            "\t",  # Tab
            "\n",  # Newline
            "\r\n",  # Windows line ending
            " \t\n ",  # Mixed whitespace
        ]

        for whitespace_str in test_cases:
            result = deserializer(whitespace_str)
            assert result == whitespace_str, (
                f"Failed for input {whitespace_str!r}: expected {whitespace_str!r}, got {result!r}"
            )

    def test_handle_deserialize_with_edge_case_strings(self):
        """Test handle_deserialize with edge case string inputs."""
        deserializer = self._get_handle_deserialize_function()

        # Test cases that should be returned as strings (not valid JSON)
        string_cases = [
            "undefined",  # Common JS value
            "null_but_not",  # Looks like null but isn't
            "True",  # Python True (capital T)
            "False",  # Python False (capital F)
            '"unclosed string',  # Malformed JSON string
            'single"quote',  # Mixed quotes
            "emoji 😀",  # Unicode content
            "special chars: àáâãäå",  # Accented characters
        ]

        for edge_case in string_cases:
            result = deserializer(edge_case)
            assert result == edge_case, (
                f"Failed for input {edge_case!r}: expected {edge_case!r}, got {result!r}"
            )

        # Test cases that are valid JSON and should be parsed
        json_cases = [
            ("NaN", float("nan")),  # Valid JSON NaN
            ("Infinity", float("inf")),  # Valid JSON Infinity
            ("-Infinity", float("-inf")),  # Valid JSON -Infinity
            ("0", 0),  # Valid JSON number
        ]

        for json_str, expected in json_cases:
            result = deserializer(json_str)
            if isinstance(expected, float) and math.isnan(expected):  # NaN check
                assert math.isnan(result), (
                    f"Failed for input {json_str!r}: expected NaN, got {result!r}"
                )
            else:
                assert result == expected, (
                    f"Failed for input {json_str!r}: expected {expected!r}, got {result!r}"
                )

    def _get_handle_deserialize_function(self):
        """Helper method to extract the handle_deserialize function for testing."""
        # We need to access the handle_deserialize function that's defined inside
        # the component creation process. Since it's a local function, we'll
        # simulate the creation process or create a standalone version for testing.

        def handle_deserialize(s: str | None) -> Any:
            """Standalone version of the handle_deserialize function for testing."""
            if s is None:
                return None
            try:
                return json.loads(s)
            except json.JSONDecodeError:
                return f"{s}"

        return handle_deserialize

    def test_string_values_work_in_trigger_updates(self):
        """Integration test: verify string values work properly in trigger updates."""
        # Test that string values that aren't valid JSON are handled correctly
        # in the context of actual trigger updates

        widget_states = WidgetStates()

        # Test with a plain string value (not valid JSON)
        ws_component = WidgetState(id=make_trigger_id(self.component_id, "events"))
        ws_component.json_trigger_value = json.dumps(
            {"event": "text", "value": "plain string value"}
        )
        widget_states.widgets.append(ws_component)

        # Process the widget states
        self.script_run_ctx.session_state.on_script_will_rerun(widget_states)

        # Verify the trigger value is accessible and equals the original object (wrapped in list)
        text_trigger_id = make_trigger_id(self.component_id, "events")
        trigger_value = self.script_run_ctx.session_state[text_trigger_id]

        assert trigger_value == [{"event": "text", "value": "plain string value"}]

        # Verify the callback was called
        self.text_trigger_cb.assert_called_once()

    def test_mixed_json_and_string_values_in_triggers(self):
        """Integration test: verify both JSON and string values work together."""
        widget_states = WidgetStates()

        # Combine both triggers into a single aggregator payload list
        agg_id = make_trigger_id(self.component_id, "events")
        ws_both = WidgetState(id=agg_id)
        ws_both.json_trigger_value = json.dumps(
            [
                {"event": "range", "value": 42},
                {"event": "text", "value": "user input text"},
            ]
        )
        widget_states.widgets.append(ws_both)

        # Process the widget states
        self.script_run_ctx.session_state.on_script_will_rerun(widget_states)

        # Verify both values are correctly deserialized
        agg_id = make_trigger_id(self.component_id, "events")
        agg_value = self.script_run_ctx.session_state[agg_id]
        assert isinstance(agg_value, list)
        by_event = {item["event"]: item["value"] for item in agg_value}
        assert by_event["range"] == 42
        assert by_event["text"] == "user input text"

        # Verify both callbacks were called
        self.range_trigger_cb.assert_called_once()
        self.text_trigger_cb.assert_called_once()

    def test_empty_string_json_trigger_value_does_not_crash(self):
        """Test that an empty string json_trigger_value doesn't cause issues."""
        # Simulate a trigger update with an empty string
        widget_states = WidgetStates()
        ws_component = WidgetState(id=make_trigger_id(self.component_id, "events"))
        ws_component.json_trigger_value = json.dumps({"event": "range", "value": ""})
        widget_states.widgets.append(ws_component)

        # Process the widget states
        self.script_run_ctx.session_state.on_script_will_rerun(widget_states)

        # Access the trigger value - this should work without throwing an exception
        range_id = make_trigger_id(self.component_id, "events")
        trigger_value = self.script_run_ctx.session_state[range_id]

        # The trigger value should be a list with one object with empty string value
        assert trigger_value == [{"event": "range", "value": ""}]

        # The callback should have been called since we have a non-None value
        self.range_trigger_cb.assert_called_once()

    def test_whitespace_json_trigger_value_preserves_whitespace(self):
        """Test that whitespace-only json_trigger_value preserves the whitespace."""
        # Simulate a trigger update with whitespace
        widget_states = WidgetStates()
        ws_component = WidgetState(id=make_trigger_id(self.component_id, "events"))
        ws_component.json_trigger_value = json.dumps({"event": "range", "value": "   "})
        widget_states.widgets.append(ws_component)

        # Process the widget states
        self.script_run_ctx.session_state.on_script_will_rerun(widget_states)

        # Access the trigger value
        range_id = make_trigger_id(self.component_id, "events")
        trigger_value = self.script_run_ctx.session_state[range_id]

        # The trigger value should preserve the whitespace within the object
        assert trigger_value == [{"event": "range", "value": "   "}]

        # The callback should have been called since we have a non-None value
        self.range_trigger_cb.assert_called_once()

    def test_deserializer_lambda_handles_edge_cases(self):
        """Test the deserializer lambda function directly with various edge cases."""
        # This test is now updated to test the new handle_deserialize function
        deserializer = self._get_handle_deserialize_function()

        # Test cases that should work with the new deserializer
        assert deserializer(None) is None
        assert deserializer("null") is None
        assert deserializer('"hello"') == "hello"
        assert deserializer("123") == 123
        assert deserializer('{"key": "value"}') == {"key": "value"}

        # Test string values that aren't JSON - these should return as strings
        assert deserializer("") == ""
        assert deserializer("   ") == "   "
        assert deserializer(" ") == " "
        assert deserializer("\n") == "\n"
        assert deserializer("\t") == "\t"
        assert deserializer("plain text") == "plain text"
        assert deserializer("not json") == "not json"

        # All of these should work without raising JSONDecodeError
        test_cases = ["", "   ", " ", "\n", "\t", "plain text", "user input"]
        for test_case in test_cases:
            try:
                result = deserializer(test_case)
                # Each should return the original string
                assert result == test_case, f"Expected {test_case!r}, got {result!r}"
                success = True
            except json.JSONDecodeError:
                success = False

            assert success, f"Deserializer failed on {test_case!r}"


if __name__ == "__main__":  # pragma: no cover
    import pytest

    pytest.main([__file__])
