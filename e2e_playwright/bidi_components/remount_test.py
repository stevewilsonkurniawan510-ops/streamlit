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

from playwright.sync_api import Page, expect

from e2e_playwright.conftest import wait_for_app_run
from e2e_playwright.shared.app_utils import click_button


def test_state_persists_across_unmount_and_remount(app: Page) -> None:
    # Initial defaults
    expect(app.get_by_label("Range")).to_have_value("10")
    expect(app.get_by_label("Text")).to_have_value("hello")
    expect(
        app.get_by_text("session_state: {'value': {'range': 10, 'text': 'hello'}}")
    ).to_be_visible()

    # Interact to change state
    app.get_by_label("Range").fill("25")
    app.get_by_label("Text").fill("world")
    wait_for_app_run(app)

    # Assert DOM reflects the changes
    expect(app.get_by_label("Range")).to_have_value("25")
    expect(app.get_by_label("Text")).to_have_value("world")

    expect(
        app.get_by_text(
            "session_state: {'value': {'range': '25', 'text': 'world'}}",
        )
    ).to_be_visible()
    expect(app.get_by_text("Range change count: 1")).to_be_visible()
    expect(app.get_by_text("Text change count: 1")).to_be_visible()

    # Trigger unmount/remount via standard pattern
    click_button(app, "Create some elements to unmount component")

    # Verify that DOM values and session_state persisted across remount
    expect(app.get_by_label("Range")).to_have_value("25")
    expect(app.get_by_label("Text")).to_have_value("world")
    expect(
        app.get_by_text("session_state: {'value': {'range': '25', 'text': 'world'}}")
    ).to_be_visible()

    # Interact again to ensure handlers still work after remount
    app.get_by_label("Range").fill("30")
    app.get_by_label("Text").fill("!")
    wait_for_app_run(app)

    # Assert DOM and session_state after second change
    expect(app.get_by_label("Range")).to_have_value("30")
    expect(app.get_by_label("Text")).to_have_value("!")
    expect(
        app.get_by_text(
            "session_state: {'value': {'range': '30', 'text': '!'}}",
        )
    ).to_be_visible()
    expect(app.get_by_text("Range change count: 2")).to_be_visible()
    expect(app.get_by_text("Text change count: 2")).to_be_visible()
