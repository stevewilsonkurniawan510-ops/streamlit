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

from types import SimpleNamespace
from typing import Any

from streamlit.runtime.state.common import WidgetMetadata
from streamlit.runtime.state.presentation import present_for_session
from streamlit.runtime.state.session_state import SessionState


class _FakeWStates:
    def __init__(self) -> None:
        self.widget_metadata: dict[str, Any] = {}


class _FakeSession:
    def __init__(self) -> None:
        self._new_widget_state = _FakeWStates()


def test_present_for_session_returns_base_when_no_meta() -> None:
    """Return base value unchanged when widget metadata is missing."""
    ss = _FakeSession()
    base = {"value": 1}
    out = present_for_session(ss, "wid", base)
    assert out is base


def test_present_for_session_returns_base_when_no_presenter() -> None:
    """Return base value unchanged when metadata has no presenter."""
    ss = _FakeSession()
    ss._new_widget_state.widget_metadata["wid"] = SimpleNamespace()
    base = [1, 2, 3]
    out = present_for_session(ss, "wid", base)
    assert out is base


def test_present_for_session_applies_presenter() -> None:
    """Apply the registered presenter to the base value."""

    def _presenter(base: Any, _ss: Any) -> Any:
        return {"presented": base}

    ss = _FakeSession()
    ss._new_widget_state.widget_metadata["wid"] = SimpleNamespace(presenter=_presenter)
    base = {"value": 123}
    out = present_for_session(ss, "wid", base)
    assert out == {"presented": {"value": 123}}


def test_present_for_session_swallows_presenter_errors() -> None:
    """Return base value unchanged if presenter raises an exception."""

    def _boom(_base: Any, _ss: Any) -> Any:
        raise RuntimeError("boom")

    ss = _FakeSession()
    ss._new_widget_state.widget_metadata["wid"] = SimpleNamespace(presenter=_boom)
    base = "hello"
    out = present_for_session(ss, "wid", base)
    assert out is base


def test_presenter_applied_once_via_getitem_and_filtered_state() -> None:
    """Presenter must be applied exactly once for both __getitem__ and filtered_state.

    We simulate a widget with a user key mapping and attach a presenter that wraps
    the base value in a dict. Double application would produce nested wrapping.
    """

    ss = SessionState()

    # Simulate a widget with element id and user key mapping
    widget_id = "$$ID-abc-ukey"
    user_key = "ukey"

    # Register metadata with a no-op deserializer/serializer for a simple string
    meta = WidgetMetadata[str](
        id=widget_id,
        deserializer=lambda v: v,
        serializer=lambda v: v,
        value_type="string_value",
    )
    ss._set_widget_metadata(meta)
    ss._set_key_widget_mapping(widget_id, user_key)

    # Set the underlying widget value in new widget state
    ss._new_widget_state.set_from_value(widget_id, "base")

    # Install a presenter that wraps once
    def _wrap_once(base: Any, _ss: Any) -> Any:
        return {"presented": base}

    # Attach presenter to metadata store
    ss._new_widget_state.widget_metadata[widget_id] = SimpleNamespace(
        id=widget_id,
        deserializer=meta.deserializer,
        serializer=meta.serializer,
        value_type=meta.value_type,
        presenter=_wrap_once,
    )

    # Access via __getitem__ using the widget id; should apply once
    got = ss[widget_id]
    assert got == {"presented": "base"}

    # Access via filtered_state using the user key; should apply once
    filtered = ss.filtered_state
    assert filtered[user_key] == {"presented": "base"}
