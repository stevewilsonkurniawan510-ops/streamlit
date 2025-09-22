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

import json
from collections.abc import Mapping
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Final, TypedDict, cast

from streamlit.components.v2.presentation import make_bidi_component_presenter
from streamlit.dataframe_util import (
    DataFormat,
    convert_anything_to_arrow_bytes,
    determine_data_format,
    is_dataframe_like,
)
from streamlit.elements.lib.form_utils import current_form_id
from streamlit.elements.lib.layout_utils import (
    Height,
    LayoutConfig,
    Width,
    validate_width,
)
from streamlit.elements.lib.policies import check_cache_replay_rules
from streamlit.elements.lib.utils import compute_and_register_element_id, to_key
from streamlit.errors import StreamlitAPIException
from streamlit.proto.ArrowData_pb2 import ArrowData as ArrowDataProto
from streamlit.proto.BidiComponent_pb2 import BidiComponent as BidiComponentProto
from streamlit.proto.BidiComponent_pb2 import MixedData as MixedDataProto
from streamlit.runtime.metrics_util import gather_metrics
from streamlit.runtime.scriptrunner_utils.script_run_context import get_script_run_ctx
from streamlit.runtime.state import register_widget
from streamlit.util import AttributeDictionary

if TYPE_CHECKING:
    # Define DeltaGenerator for type checking the dg property
    from streamlit.delta_generator import DeltaGenerator
    from streamlit.runtime.state.common import WidgetCallback


INTERNAL_COMPONENT_NAME = "bidi_component"

# Shared constant that delimits the base widget id from the event suffix.
# This value **must** stay in sync with its TypeScript counterpart defined in
# `frontend/lib/src/components/widgets/BidiComponent/constants.ts`.
EVENT_DELIM: Final[str] = "__"

# Shared constant that is used to identify ArrowReference objects in the data structure.
# This value **must** stay in sync with its TypeScript counterpart defined in
# `frontend/lib/src/components/widgets/BidiComponent/constants.ts`.
ARROW_REF_KEY: Final[str] = "__streamlit_arrow_ref__"


def _extract_dataframes_from_dict(
    data: dict[str, Any], arrow_blobs: dict[str, bytes] | None = None
) -> dict[str, Any]:
    """Extract dataframe-like objects from first level of dictionary and replace with placeholders.

    This function traverses the first level of a dictionary, detects any
    dataframe-like objects, stores their Arrow bytes in the arrow_blobs dict,
    and replaces them with JSON-serializable placeholder objects.

    Parameters
    ----------
    data : dict[str, Any]
        The dictionary to process (only first level is checked)
    arrow_blobs : dict[str, bytes] | None
        Dictionary to store extracted Arrow bytes, keyed by reference ID

    Returns
    -------
    dict[str, Any]
        The dictionary with dataframe-like objects replaced by placeholders
    """
    import uuid

    if arrow_blobs is None:
        arrow_blobs = {}

    processed_data = {}

    for key, value in data.items():
        if is_dataframe_like(value):
            # This is a dataframe-like object, serialize it to Arrow
            try:
                arrow_bytes = convert_anything_to_arrow_bytes(value)
                ref_id = str(uuid.uuid4())
                arrow_blobs[ref_id] = arrow_bytes
                processed_data[key] = {ARROW_REF_KEY: ref_id}
            except Exception:
                # If Arrow serialization fails, keep the original value for JSON serialization
                processed_data[key] = value
        else:
            # Not dataframe-like, keep as-is
            processed_data[key] = value

    return processed_data


def _serialize_mixed_data(data: Any, bidi_component_proto: BidiComponentProto) -> None:
    """Serialize mixed data with automatic dataframe detection.

    This function detects dataframe-like objects in the first level of dictionary data,
    extracts them into separate Arrow blobs, and creates a MixedData
    protobuf structure for efficient serialization.

    Parameters
    ----------
    data : Any
        The data structure that may contain dataframe-like objects in the first level
    bidi_component_proto : BidiComponentProto
        The protobuf object to populate with the mixed data
    """
    arrow_blobs: dict[str, bytes] = {}

    # Only process dictionaries for automatic dataframe detection
    if isinstance(data, dict):
        processed_data = _extract_dataframes_from_dict(data, arrow_blobs)
    else:
        # For non-dict data (lists, tuples, etc.), pass through as-is
        # We don't automatically detect dataframes in these structures
        processed_data = data

    if arrow_blobs:
        # We have dataframes, use mixed data serialization
        mixed_proto = MixedDataProto()
        try:
            mixed_proto.json = json.dumps(processed_data)
        except TypeError:
            # If JSON serialization fails (e.g., due to undetected dataframes),
            # fall back to string representation
            mixed_proto.json = json.dumps(str(processed_data))

        # Add Arrow blobs to the protobuf
        for ref_id, arrow_bytes in arrow_blobs.items():
            mixed_proto.arrow_blobs[ref_id].data = arrow_bytes

        bidi_component_proto.mixed.CopyFrom(mixed_proto)
    else:
        # No dataframes found, use regular JSON serialization
        try:
            bidi_component_proto.json = json.dumps(processed_data)
        except TypeError:
            # If JSON serialization fails (e.g., due to dataframes in lists/tuples),
            # fall back to string representation
            bidi_component_proto.json = json.dumps(str(processed_data))


def make_trigger_id(base: str, event: str) -> str:
    """Construct the per-event *trigger widget* identifier.

    The widget id for a trigger is derived from the *base* component id plus
    an *event* name. We join those two parts with :pydata:`EVENT_DELIM` and
    perform a couple of validations so that downstream logic can always split
    the identifier unambiguously.

    Trigger widgets are marked as internal by prefixing with the internal key prefix,
    so they won't be exposed in st.session_state to end users.

    Parameters
    ----------
    base : str
        The unique, framework-assigned id of the component instance.
    event : str
        The event name as provided by either the frontend or the developer
        (e.g. "click", "change").

    Returns
    -------
    str
        The composite widget id in the form ``"$$STREAMLIT_INTERNAL_KEY_{base}__{event}"``
        where ``__`` is the delimiter.

    Raises
    ------
    ValueError
        If either *base* or *event* already contains the delimiter sequence.
    """
    from streamlit.runtime.state.session_state import STREAMLIT_INTERNAL_KEY_PREFIX

    if EVENT_DELIM in base:
        raise StreamlitAPIException(
            "Base component id must not contain the delimiter sequence"
        )
    if EVENT_DELIM in event:
        raise StreamlitAPIException(
            "Event name must not contain the delimiter sequence"
        )

    return f"{STREAMLIT_INTERNAL_KEY_PREFIX}_{base}{EVENT_DELIM}{event}"


def handle_deserialize(s: str | None) -> Any:
    """Deserialize a JSON string or return the string as-is if it's not valid JSON."""
    if s is None:
        return None
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        return f"{s}"


def _deserialize_trigger_list(s: str | None) -> list[Any] | None:
    """Deserialize trigger aggregator payloads as a list.

    For Custom Components v2, the frontend always sends a JSON array of payload
    objects. This deserializer normalizes older/singular payloads into a list
    while preserving ``None`` for cleared values.
    """
    value = handle_deserialize(s)
    if value is None:
        return None
    if isinstance(value, list):
        return value
    return [value]


# ----------------------------------------------------------------------
# Public state typing
# ----------------------------------------------------------------------


class BidiComponentState(TypedDict, total=False):
    """
    The schema for the BidiComponent state.

    The state is stored in a dictionary-like object that supports both key and
    attribute notation. States cannot be programmatically changed or set through
    Session State.

    Attributes
    ----------
    value : dict[str, Any]
        The current value of the component instance returned from the frontend,
        or the default value if not yet set.
    """

    value: dict[str, Any]


class BidiComponentResult(AttributeDictionary):
    """Rich return object for ``st.bidi_component``.

    It behaves like a regular :class:`dict` *and* allows attribute-style
    access to its keys, mirroring the behaviour of
    :class:`streamlit.util.AttributeDictionary`. In addition, it surfaces the
    :pyclass:`~streamlit.delta_generator.DeltaGenerator` instance responsible
    for rendering the component via the dedicated :pyattr:`delta_generator`
    property.
    """

    def __init__(
        self,
        dg: DeltaGenerator,
        state_vals: dict[str, Any] | None = None,
        trigger_vals: dict[str, Any] | None = None,
    ) -> None:
        if state_vals is None:
            state_vals = {}
        if trigger_vals is None:
            trigger_vals = {}

        # We store the DeltaGenerator under a dedicated key so that callers can
        # access it via both attribute and mapping syntax without colliding
        # with user-supplied state or trigger names.
        super().__init__(
            {
                "delta_generator": dg,
                # The order here matters, because all stateful values will
                # always be returned, but trigger values may be transient.
                **trigger_vals,
                **state_vals,
            }
        )

    # Expose a typed property for convenient IDE auto-completion.
    @property
    def delta_generator(self) -> DeltaGenerator:
        """Return the :class:`~streamlit.delta_generator.DeltaGenerator` that
        rendered this component.
        """
        return cast("DeltaGenerator", self["delta_generator"])


@dataclass
class BidiComponentSerde:
    """Serialization/deserialization logic for BidiComponent.

    Assumes communication via JSON strings.
    """

    default: dict[str, Any] | None = None

    def deserialize(self, ui_value: str | dict[str, Any] | None) -> BidiComponentState:
        """Deserialize the state from the frontend.

        Args:
            ui_value: The JSON string received from the frontend.

        Returns
        -------
            The deserialized state wrapped in an AttributeDictionary.
        """
        # We always normalise the incoming JSON payload into a *dict*.
        # Any failure to decode (or an unexpected non-mapping structure)
        # results in an empty mapping so that the returned type adheres to
        # :class:`BidiComponentState`.

        deserialized_value: dict[str, Any]

        if isinstance(ui_value, dict):
            deserialized_value = ui_value
        elif ui_value is not None:
            try:
                parsed = json.loads(ui_value)  # ty: ignore[invalid-argument-type]
                deserialized_value = parsed if isinstance(parsed, dict) else {}
            except Exception:
                deserialized_value = {}
        else:
            deserialized_value = {}

        # Apply default values for keys that don't exist in the current state
        if self.default is not None:
            for default_key, default_value in self.default.items():
                if default_key not in deserialized_value:
                    deserialized_value[default_key] = default_value

        state: BidiComponentState = {"value": deserialized_value}
        return cast("BidiComponentState", AttributeDictionary(state))

    def serialize(self, value: Any) -> str:
        """Serialize the value to be sent to the frontend.

        Args:
            value: The value to serialize.

        Returns
        -------
            A JSON string representation of the value.
        """
        return json.dumps(value)


class BidiComponentMixin:
    """Mixin class for the bidi_component DeltaGenerator method."""

    @gather_metrics("bidi_component")
    def bidi_component(
        self,
        component_name: str,
        *args: Any,
        key: str | None = None,
        isolate_styles: bool = True,
        data: Any | None = None,
        default: dict[str, Any] | None = None,
        width: Width = "stretch",
        height: Height = "content",
        **kwargs: WidgetCallback | None,
    ) -> BidiComponentResult:
        """Add a bidirectional component instance to the app using a registered component.

        Parameters
        ----------
        component_name : str
            The name of the registered component to use. The component's HTML, CSS,
            and JS will be loaded from the registry.
        *args
            Positional arguments to pass to the component.
        key : str or None
            An optional string to use as the unique key for the component.
            If this is omitted, a key will be generated based on the
            component's execution sequence.
        isolate_styles : bool
            Whether to sandbox the component styles in a shadow-root. Defaults to
            True.
        data : Any or None
            Data to pass to the component (JSON-serializable).
        default : dict[str, Any] or None
            A dictionary of default values for state properties. These defaults
            are applied only when the state key doesn't exist in session state.
            Keys must correspond to valid state names (those with on_*_change
            callbacks). Trigger values do not support defaults.
        width : Width
            The width of the component.
        height : Height
            The height of the component.
        **kwargs
            Keyword arguments to pass to the component.

        Returns
        -------
        BidiComponentResult
            A dictionary-like result object.

        Raises
        ------
        ValueError
            If the component is not registered in the registry.
        StreamlitAPIException
            If the component does not have the required JavaScript or HTML content.
        """
        check_cache_replay_rules()

        key = to_key(key)
        ctx = get_script_run_ctx()

        if ctx is None:
            # Create an empty state with the default value and return it
            state: BidiComponentState = {"value": {}}
            return BidiComponentResult(self.dg, state.get("value", {}), {})

        # Get the component definition from the registry
        from streamlit.runtime import Runtime

        registry = Runtime.instance().bidi_component_registry
        component_def = registry.get(component_name)

        if component_def is None:
            raise ValueError(f"Component '{component_name}' is not registered")

        # Validate that the component has the required content
        has_js = bool(component_def.js_content or component_def.js_url)
        has_html = bool(component_def.html_content)

        if not has_js and not has_html:
            raise StreamlitAPIException(
                f"Component '{component_name}' must have either JavaScript content "
                "(js_content or js_url) or HTML content (html_content), or both. "
                "Please ensure the component definition includes at least one of these."
            )

        # Compute a unique ID for this component instance
        computed_id = compute_and_register_element_id(
            component_name,
            user_key=key,
            dg=self.dg,
            key_as_main_identity=True,
        )

        # ------------------------------------------------------------------
        # 1. Parse user-supplied callbacks
        # ------------------------------------------------------------------
        # Event-specific callbacks follow the pattern ``on_<event>_change``.
        # We deliberately *do not* support the legacy generic ``on_change``
        # or ``on_<event>`` forms.
        callbacks_by_event: dict[str, WidgetCallback] = {}
        for kwarg_key, kwarg_value in list(kwargs.items()):
            if not callable(kwarg_value):
                continue

            if kwarg_key.startswith("on_") and kwarg_key.endswith("_change"):
                # Preferred pattern: on_<event>_change
                event_name = kwarg_key[3:-7]  # strip prefix + suffix
            else:
                # Not an event callback we recognize - skip.
                continue

            if not event_name:
                # Malformed name like "on__change" - ignore for now.
                continue

            callbacks_by_event[event_name] = kwarg_value

        # ------------------------------------------------------------------
        # 2. Validate default keys against registered callbacks
        # ------------------------------------------------------------------
        if default is not None:
            for state_key in default:
                if state_key not in callbacks_by_event:
                    raise StreamlitAPIException(
                        f"Key '{state_key}' in default is not a valid state name. "
                        f"Valid state names are those with corresponding on_{{state_name}}_change "
                        f"callbacks. Available state names: {list(callbacks_by_event.keys()) or 'none'}"
                    )

        # Set up the component proto
        bidi_component_proto = BidiComponentProto()
        bidi_component_proto.id = computed_id
        bidi_component_proto.component_name = component_name
        bidi_component_proto.isolate_styles = isolate_styles
        bidi_component_proto.js_content = component_def.js_content or ""
        bidi_component_proto.js_source_path = component_def.js_url or ""
        bidi_component_proto.html_content = component_def.html_content or ""
        bidi_component_proto.css_content = component_def.css_content or ""
        bidi_component_proto.css_source_path = component_def.css_url or ""

        validate_width(width, allow_content=True)
        layout_config = LayoutConfig(width=width, height=height)

        if data is not None:
            try:
                # 1. Raw byte payloads - forward as-is.
                if isinstance(data, (bytes, bytearray)):
                    bidi_component_proto.bytes = bytes(data)

                # 2. Mapping-like structures (e.g. plain dict) - check for mixed data.
                elif isinstance(data, (Mapping, list, tuple)):
                    _serialize_mixed_data(data, bidi_component_proto)

                # 3. Dataframe-like structures - attempt Arrow serialization.
                else:
                    data_format = determine_data_format(data)

                    if data_format != DataFormat.UNKNOWN:
                        arrow_bytes = convert_anything_to_arrow_bytes(data)

                        arrow_data_proto = ArrowDataProto()
                        arrow_data_proto.data = arrow_bytes

                        bidi_component_proto.arrow_data.CopyFrom(arrow_data_proto)
                    else:
                        # Fallback to JSON.
                        bidi_component_proto.json = json.dumps(data)
            except Exception:
                # As a last resort attempt JSON serialization so that we don't
                # silently drop developer data.
                try:
                    bidi_component_proto.json = json.dumps(data)
                except Exception:
                    raise StreamlitAPIException(
                        "BidiComponent was unable to serialise the provided ``data``."
                    )
        bidi_component_proto.form_id = current_form_id(self.dg)

        # Instantiate the Serde for this component instance
        serde = BidiComponentSerde(default=default)

        # ------------------------------------------------------------------
        # 2. Prepare IDs and register widgets
        # ------------------------------------------------------------------

        # Compute trigger aggregator id from the base id
        def _make_trigger_aggregator_id(base: str) -> str:
            return make_trigger_id(base, "events")

        aggregator_id = _make_trigger_aggregator_id(computed_id)

        # With generalized runtime dispatch, we can attach per-key callbacks
        # directly to the state widget by passing the callbacks mapping.
        # We also register a presenter to shape the user-visible session_state.
        presenter = make_bidi_component_presenter(aggregator_id)
        component_state = register_widget(
            bidi_component_proto.id,
            deserializer=serde.deserialize,
            serializer=serde.serialize,
            ctx=ctx,
            callbacks=callbacks_by_event if callbacks_by_event else None,
            value_type="json_value",
            presenter=presenter,
        )

        # ------------------------------------------------------------------
        # 3. Register a single *trigger aggregator* widget
        # ------------------------------------------------------------------
        trigger_vals: dict[str, Any] = {}

        trig_state = register_widget(
            aggregator_id,
            deserializer=_deserialize_trigger_list,  # always returns list or None
            serializer=lambda v: json.dumps(v),  # send dict as JSON
            ctx=ctx,
            callbacks=callbacks_by_event if callbacks_by_event else None,
            value_type="json_trigger_value",
        )

        # Surface per-event trigger values derived from the aggregator payload list.
        payloads: list[object] = trig_state.value or []

        event_to_value: dict[str, Any] = {}
        for payload in payloads:
            if isinstance(payload, dict):
                ev = payload.get("event")
                if isinstance(ev, str):
                    event_to_value[ev] = payload.get("value")

        for evt_name in callbacks_by_event:
            trigger_vals[evt_name] = event_to_value.get(evt_name)

        # Note: We intentionally do not inspect SessionState for additional
        # trigger widget IDs here because doing so can raise KeyErrors when
        # widgets are freshly registered but their values haven't been
        # populated yet. Only the triggers explicitly registered above are
        # included in the result object.

        # ------------------------------------------------------------------
        # 4. Enqueue proto and assemble the result object
        # ------------------------------------------------------------------
        self.dg._enqueue(
            INTERNAL_COMPONENT_NAME,
            bidi_component_proto,
            layout_config=layout_config,
        )

        state_vals = _unwrap_component_state(component_state.value)

        return BidiComponentResult(self.dg, state_vals, trigger_vals)

    @property
    def dg(self) -> DeltaGenerator:
        """Get our DeltaGenerator."""
        return cast("DeltaGenerator", self)


# ----------------------------------------------------------------------
# Internal helpers
# ----------------------------------------------------------------------


def _unwrap_component_state(raw_state: Any) -> dict[str, Any]:
    """Return the inner mapping of a *valid* :class:`BidiComponentState`.

    A valid component state **must** be a mapping that contains exactly one key:
    ``"value"``, whose associated value is itself a mapping holding the actual
    per-key state entries produced by the frontend.

    Any other shape is considered invalid and will be treated as an empty
    mapping. This strictness ensures we never silently accept malformed data
    that could mask bugs elsewhere in the stack.

    Parameters
    ----------
    raw_state : Any
        The value retrieved from Session State.

    Returns
    -------
    dict[str, Any]
        The *inner* state mapping if the input adheres to the expected
        structure, otherwise an empty ``dict``.
    """

    if (
        isinstance(raw_state, dict)
        and set(raw_state.keys()) == {"value"}
        and isinstance(raw_state["value"], dict)
    ):
        # Shallow-copy to decouple from the original reference.
        return dict(raw_state["value"])

    # Any deviation from the expected schema is regarded as invalid.
    return {}
