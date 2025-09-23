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

from playwright.sync_api import Locator, Page, expect


def section(app: Page, heading_name: str) -> Locator:
    """Return the closest stLayoutWrapper ancestor of the named header."""
    header = app.get_by_role("heading", name=heading_name)
    return header.locator("xpath=ancestor::*[@data-testid='stLayoutWrapper'][1]")


def test_stateful_interactions(app: Page) -> None:
    # Initial values
    stateful = section(app, "Stateful")
    expect(stateful.get_by_label("Range").first).to_have_value("50")
    expect(stateful.get_by_label("Text").first).to_have_value("Text input")

    expect(
        stateful.get_by_text(
            "Result: {'delta_generator': DeltaGenerator(), 'range': None, 'text': None}"
        )
    ).to_be_visible()
    expect(stateful.get_by_text("session_state: {'value': {}}")).to_be_visible()
    expect(stateful.get_by_text("Range change count: 0")).to_be_visible()
    expect(stateful.get_by_text("Text change count: 0")).to_be_visible()

    # Change Range value (only range changes)
    stateful.get_by_label("Range").first.fill("10")
    expect(stateful.get_by_label("Range").first).to_have_value("10")
    expect(
        stateful.get_by_text(
            "Result: {'delta_generator': DeltaGenerator(), 'range': '10', 'text': None}"
        )
    ).to_be_visible()
    expect(
        stateful.get_by_text("session_state: {'value': {'range': '10'}}")
    ).to_be_visible()
    expect(stateful.get_by_text("Range change count: 1")).to_be_visible()
    expect(stateful.get_by_text("Text change count: 0")).to_be_visible()

    # Change Text value (only text changes)
    stateful.get_by_label("Text").first.fill("Hello")
    expect(stateful.get_by_label("Text").first).to_have_value("Hello")
    expect(
        stateful.get_by_text(
            "Result: {'delta_generator': DeltaGenerator(), 'range': '10', 'text': 'Hello'}"
        )
    ).to_be_visible()
    expect(
        stateful.get_by_text(
            "session_state: {'value': {'range': '10', 'text': 'Hello'}}"
        )
    ).to_be_visible()
    expect(stateful.get_by_text("Range change count: 1")).to_be_visible()
    expect(stateful.get_by_text("Text change count: 1")).to_be_visible()

    # Trigger an unrelated rerun via a Streamlit button; values remain
    app.get_by_text("st.button trigger").click()
    expect(
        stateful.get_by_text(
            "Result: {'delta_generator': DeltaGenerator(), 'range': '10', 'text': 'Hello'}"
        )
    ).to_be_visible()
    expect(
        stateful.get_by_text(
            "session_state: {'value': {'range': '10', 'text': 'Hello'}}"
        )
    ).to_be_visible()
    expect(stateful.get_by_text("Range change count: 1")).to_be_visible()
    expect(stateful.get_by_text("Text change count: 1")).to_be_visible()
