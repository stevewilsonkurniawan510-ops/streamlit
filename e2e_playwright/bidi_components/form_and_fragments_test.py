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

from e2e_playwright.shared.app_utils import click_form_button


def test_form_interactions_deferred_until_submit(app: Page):
    # Initial state
    expect(app.get_by_text("Runs: 1")).to_be_visible()
    expect(app.get_by_text("Form Text changes: 0")).to_be_visible()
    expect(app.get_by_text("Form Clicked count: 0")).to_be_visible()
    # Before submitting the form, interactions should NOT trigger a rerun.
    app.get_by_text("Set text (Form)").click()
    expect(app.get_by_text("Runs: 1")).to_be_visible()
    expect(app.get_by_text("Form Text changes: 0")).to_be_visible()

    # Triggers are disallowed in forms for CCv2; this must be a no-op.
    app.get_by_text("Trigger click (Form)").click()
    expect(app.get_by_text("Runs: 1")).to_be_visible()
    expect(app.get_by_text("Form Clicked count: 0")).to_be_visible()

    # Also the displayed state should still be empty before submit.
    expect(app.get_by_text("Form session state: {'value': {}}")).to_be_visible()

    # Submit the form and verify rerun + updates (only stateful changes apply).
    click_form_button(app, "Submit Form")

    expect(app.get_by_text("Runs: 2")).to_be_visible()
    # Trigger callback remains unchanged due to no-op in form.
    expect(app.get_by_text("Form Text changes: 1")).to_be_visible()
    expect(app.get_by_text("Form Clicked count: 0")).to_be_visible()

    # Session state should now contain values set by the component.
    expect(app.get_by_text("Form session state:")).not_to_have_text(
        "Form session state: {'value': {}}"
    )
    expect(app.get_by_text("Form session state:")).to_contain_text("text")


def test_fragment_interactions_rerun_only_fragment(app: Page):
    # Initial state for fragments
    expect(app.get_by_text("Runs: 1")).to_be_visible()
    expect(app.get_by_text("Fragment session state: {'value': {}}"))
    expect(app.get_by_text("Fragment Text changes: 0")).to_be_visible()
    expect(app.get_by_text("Fragment Clicked count: 0")).to_be_visible()

    # Interact inside fragment: should update fragment content and callbacks,
    # but NOT increment global runs.
    app.get_by_text("Set text (Fragment)").click()
    # Fragment state updates immediately
    expect(app.get_by_text("Fragment session state:")).not_to_have_text(
        "Fragment session state: {'value': {}}"
    )
    expect(app.get_by_text("Fragment Text changes: 1")).to_be_visible()
    # Do not assert outer counters for fragment-only reruns; they are rendered
    # outside the fragment and won't re-render. Instead, assert Runs remains 1.
    expect(app.get_by_text("Runs: 1")).to_be_visible()

    app.get_by_text("Trigger click (Fragment)").click()
    # Trigger inside fragment updates fragment-local UI/state; full Runs remains 1.
    expect(app.get_by_text("Fragment Clicked count: 1")).to_be_visible()
    expect(app.get_by_text("Runs: 1")).to_be_visible()
