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
  const { parentElement, setStateValue } = component

  const rangeInput = parentElement.querySelector('#range')
  const textInput = parentElement.querySelector('#text')

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
) -> BidiComponentResult:
    return _my_component(
        isolate_styles=True,
        key=key,
        on_range_change=on_range_change,
        on_text_change=on_text_change,
        default=default,
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
        # The sleep here is needed, because it won't unmount the component if this is too fast.
        time.sleep(1)
        st.write("Another element")

# Render the component after the unmount trigger block
st.write("Above the component")
result = my_component(
    key="remount_component_1",
    on_range_change=handle_range_change,
    on_text_change=handle_text_change,
    default={"range": 10, "text": "hello"},
)
st.write(f"Result: {result}")
st.text(f"session_state: {st.session_state.get('remount_component_1')}")
st.write("Below the component")

st.write(f"Range change count: {st.session_state.range_change_count}")
st.write(f"Text change count: {st.session_state.text_change_count}")
