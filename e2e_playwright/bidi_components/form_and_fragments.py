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

from typing import TYPE_CHECKING, Any

import streamlit as st

if TYPE_CHECKING:
    from streamlit.components.v2.bidi_component import BidiComponentResult
    from streamlit.runtime.state.common import WidgetCallback


st.header("Bidi Component in Forms and Fragments")


JS_CODE = """
export default function(component) {
  const { parentElement, setStateValue, setTriggerValue, data } = component

  const contextName = data?.contextName ? String(data.contextName) : ''
  const textInput = parentElement.querySelector('#text-input')
  const setTextBtn = parentElement.querySelector('#set-text-btn')
  const triggerBtn = parentElement.querySelector('#trigger-btn')

  if (setTextBtn) setTextBtn.textContent = `Set text${contextName ? ` (${contextName})` : ''}`
  if (triggerBtn) triggerBtn.textContent = `Trigger click${contextName ? ` (${contextName})` : ''}`

  const onSetText = () => {
    const value = (textInput && 'value' in textInput) ? textInput.value : ''
    setStateValue('text', value)
  }

  const onTrigger = () => {
    setTriggerValue('clicked', true)
  }

  setTextBtn?.addEventListener('click', onSetText)
  triggerBtn?.addEventListener('click', onTrigger)

  return () => {
    setTextBtn?.removeEventListener('click', onSetText)
    triggerBtn?.removeEventListener('click', onTrigger)
  }
}
"""

HTML_CODE = """
<label for="text-input">Inner Text</label>
<input id="text-input" type="text" value="hello" />
<div style="margin-top: 0.5rem; display: flex; gap: 0.5rem;">
    <button id="set-text-btn">Set text</button>
    <button id="trigger-btn">Trigger click</button>
</div>
"""


def my_component(
    *,
    key: str | None = None,
    data: Any | None = None,
    on_text_change: WidgetCallback | None = None,
    on_clicked_change: WidgetCallback | None = None,
) -> BidiComponentResult:
    component = st.components.v2.component(
        name="form_frag_component",
        js=JS_CODE,
        html=HTML_CODE,
    )

    return component(
        isolate_styles=True,
        key=key,
        data=data,
        on_text_change=on_text_change,
        on_clicked_change=on_clicked_change,
    )


# ---------------------------------------------------------------------------
# Global counters and run tracking
# ---------------------------------------------------------------------------
if "runs" not in st.session_state:
    st.session_state.runs = 0
st.session_state.runs += 1

# Use separate counters for Form vs Fragment to make behavior clearer.
# The overall run counter remains shared.
if "form_text_changes" not in st.session_state:
    st.session_state.form_text_changes = 0
if "form_clicked_changes" not in st.session_state:
    st.session_state.form_clicked_changes = 0
if "frag_text_changes" not in st.session_state:
    st.session_state.frag_text_changes = 0
if "frag_clicked_changes" not in st.session_state:
    st.session_state.frag_clicked_changes = 0


def handle_form_text_change() -> None:
    st.session_state.form_text_changes += 1


def handle_form_clicked_change() -> None:
    # Triggers inside forms are ignored by CCv2 to match Streamlit form semantics.
    # This callback will only be invoked if a trigger is delivered by the backend,
    # which should not occur for form-scoped CCv2 triggers.
    st.session_state.form_clicked_changes += 1


def handle_frag_text_change() -> None:
    st.session_state.frag_text_changes += 1


def handle_frag_clicked_change() -> None:
    st.session_state.frag_clicked_changes += 1


# ---------------------------------------------------------------------------
# Form area: Interactions are deferred until submit; triggers are ignored
# ---------------------------------------------------------------------------
st.subheader("Form")
with st.form(key="bidi_form", clear_on_submit=False):
    form_result = my_component(
        key="in_form",
        data={"contextName": "Form"},
        on_text_change=handle_form_text_change,
        on_clicked_change=handle_form_clicked_change,
    )
    st.form_submit_button("Submit Form")

st.write(f"Form Result: {form_result}")
st.text(f"Form session state: {st.session_state.get('in_form')}")
st.write(f"Form Text changes: {st.session_state.form_text_changes}")
st.write(f"Form Clicked count: {st.session_state.form_clicked_changes}")

st.divider()


# ---------------------------------------------------------------------------
# Fragment area: Interactions rerun only the fragment
# ---------------------------------------------------------------------------
st.subheader("Fragment")


@st.fragment()
def render_fragment() -> None:
    frag_result = my_component(
        key="in_fragment",
        data={"contextName": "Fragment"},
        on_text_change=handle_frag_text_change,
        on_clicked_change=handle_frag_clicked_change,
    )
    st.write(f"Fragment Result: {frag_result}")
    st.text(f"Fragment session state: {st.session_state.get('in_fragment')}")
    st.write(f"Fragment Text changes: {st.session_state.frag_text_changes}")
    st.write(f"Fragment Clicked count: {st.session_state.frag_clicked_changes}")


render_fragment()

st.divider()


st.write(f"Runs: {st.session_state.runs}")
