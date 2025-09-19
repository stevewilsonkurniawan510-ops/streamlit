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

import time
from typing import TYPE_CHECKING, Any

import streamlit as st

if TYPE_CHECKING:
    from streamlit.components.v2.bidi_component import BidiComponentResult
    from streamlit.runtime.state.common import WidgetCallback

st.header("Bidi Component remount behavior")

# A simple component that updates state on input, so we can see persistence across remounts.
JS_CODE = """
export default function(component) {
  const { parentElement, setStateValue, data } = component

  const rangeInput = parentElement.querySelector('#range')
  const textInput = parentElement.querySelector('#text')

  // Initialize input values from data if provided
  if (data && typeof data.initialRange !== 'undefined') {
    rangeInput.value = String(data.initialRange)
  }
  if (data && typeof data.initialText !== 'undefined') {
    textInput.value = String(data.initialText)
  }

  const handleRangeChange = (event) => {
    setStateValue('range', event.target.value)
  }

  const handleTextChange = (event) => {
    setStateValue('text', event.target.value)
  }

  rangeInput.addEventListener('change', handleRangeChange)
  textInput.addEventListener('input', handleTextChange)

  return () => {
    rangeInput.removeEventListener('change', handleRangeChange)
    textInput.removeEventListener('input', handleTextChange)
  }
}
"""

HTML_CODE = """
<div>
  <label for="range">Range</label>
  <input type="range" id="range" min="0" max="100" value="10" />
  <label for="text">Text</label>
  <input type="text" id="text" value="hello" />
</div>
"""

_my_component = st.components.v2.component(
    "my_component",
    js=JS_CODE,
    html=HTML_CODE,
)


def my_component(
    *,
    key: str | None = None,
    on_range_change: WidgetCallback | None = None,
    on_text_change: WidgetCallback | None = None,
    default: dict[str, Any] | None = None,
    data: Any | None = None,
) -> BidiComponentResult:
    return _my_component(
        isolate_styles=True,
        key=key,
        on_range_change=on_range_change,
        on_text_change=on_text_change,
        default=default,
        data=data,
    )


if "range_change_count" not in st.session_state:
    st.session_state.range_change_count = 0
if "text_change_count" not in st.session_state:
    st.session_state.text_change_count = 0


def handle_range_change() -> None:
    st.session_state.range_change_count += 1


def handle_text_change() -> None:
    st.session_state.text_change_count += 1


# Standard unmount/remount pattern used in other tests
if st.button("Create some elements to unmount component"):
    for _ in range(3):
        # The sleep here is needed, because it won't unmount the component if
        # this is too fast.
        time.sleep(1)
        st.write("Another element")

# Resolve initial values: prefer session_state if available, else fall back to default values
component_key = "remount_component_1"
state_value = st.session_state.get(component_key)
initial_defaults: dict[str, Any] = {"range": 10, "text": "hello"}
if isinstance(state_value, dict):
    value_dict = state_value.get("value")
    if isinstance(value_dict, dict):
        initial_defaults.update(value_dict)

# Render the component after the unmount trigger block
st.write("Above the component")
result = my_component(
    key=component_key,
    on_range_change=handle_range_change,
    on_text_change=handle_text_change,
    default={"range": 10, "text": "hello"},
    data={
        "initialRange": initial_defaults.get("range", 10),
        "initialText": initial_defaults.get("text", "hello"),
    },
)
st.write(f"Result: {result}")
st.text(f"session_state: {st.session_state.get(component_key)}")
st.write("Below the component")

st.write(f"Range change count: {st.session_state.range_change_count}")
st.write(f"Text change count: {st.session_state.text_change_count}")
