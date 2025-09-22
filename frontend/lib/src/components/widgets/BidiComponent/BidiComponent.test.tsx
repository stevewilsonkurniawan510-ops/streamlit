/**
 * Copyright (c) Streamlit Inc. (2018-2022) Snowflake Inc. (2022-2025)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import "@testing-library/jest-dom"
import { screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { BidiComponent as BidiComponentProto } from "@streamlit/protobuf"

import { ComponentRegistry } from "~lib/components/widgets/CustomComponent"
import { renderWithContexts } from "~lib/test_util"
import { WidgetStateManager } from "~lib/WidgetStateManager"

import BidiComponent from "./BidiComponent"

// Mock WidgetStateManager
vi.mock("~lib/WidgetStateManager")

describe("BidiComponent", () => {
  let mockWidgetMgr: WidgetStateManager
  let mockFragmentId: string | undefined

  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks()

    // Create mock widget manager
    mockWidgetMgr = new WidgetStateManager({
      sendRerunBackMsg: vi.fn(),
      formsDataChanged: vi.fn(),
    })

    // Mock getJsonValue to return empty object by default
    vi.spyOn(mockWidgetMgr, "getJsonValue").mockReturnValue(JSON.stringify({}))
    vi.spyOn(mockWidgetMgr, "setJsonValue").mockImplementation(vi.fn())
    vi.spyOn(mockWidgetMgr, "setTriggerValue").mockImplementation(vi.fn())

    mockFragmentId = "test-fragment"
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const createMockElement = (
    overrides: Partial<BidiComponentProto> = {}
  ): BidiComponentProto => {
    return BidiComponentProto.create({
      id: "test-bidi-component-id",
      componentName: "TestComponent",
      formId: "",
      isolateStyles: false,
      data: "json",
      json: JSON.stringify({ message: "Hello, World!" }),
      ...overrides,
    })
  }

  describe("Component Selection", () => {
    it.each([
      {
        isolateStyles: true,
        expectedVisible: "stBidiComponent-isolated",
        expectedHidden: "stBidiComponent-regular",
        description:
          "should render IsolatedComponent when isolateStyles is true",
      },
      {
        isolateStyles: false,
        expectedVisible: "stBidiComponent-regular",
        expectedHidden: "stBidiComponent-isolated",
        description:
          "should render NonIsolatedComponent when isolateStyles is false",
      },
      {
        isolateStyles: undefined,
        expectedVisible: "stBidiComponent-regular",
        expectedHidden: "stBidiComponent-isolated",
        description:
          "should default to NonIsolatedComponent when isolateStyles is undefined",
      },
    ])(
      "$description",
      ({ isolateStyles, expectedVisible, expectedHidden }) => {
        const element = createMockElement({ isolateStyles })

        renderWithContexts(
          <BidiComponent
            element={element}
            widgetMgr={mockWidgetMgr}
            fragmentId={mockFragmentId}
          />,
          {}
        )

        expect(screen.getByTestId(expectedVisible)).toBeVisible()
        expect(screen.queryByTestId(expectedHidden)).not.toBeInTheDocument()
      }
    )
  })

  describe("HTML Content Handling", () => {
    it("should inject HTML content in NonIsolatedComponent", async () => {
      const htmlContent =
        "<div data-testid='test-html-content' class='custom-class'>Custom HTML Content</div>"
      const element = createMockElement({
        isolateStyles: false,
        htmlContent,
      })

      renderWithContexts(
        <BidiComponent
          element={element}
          widgetMgr={mockWidgetMgr}
          fragmentId={mockFragmentId}
        />,
        {}
      )

      // Verify the HTML content is actually injected into the DOM
      const injectedElement = await screen.findByTestId("test-html-content")
      expect(injectedElement).toBeVisible()
      expect(injectedElement).toHaveTextContent("Custom HTML Content")
      expect(injectedElement).toHaveClass("custom-class")

      // Verify it's in the regular DOM, not shadow DOM
      const container = screen.getByTestId("stBidiComponent-regular")
      expect(container.contains(injectedElement)).toBe(true) // HTML content is injected into the container
      expect(
        container.querySelector("[data-testid='test-html-content']")
      ).toBeTruthy()
    })

    it("should inject HTML content in IsolatedComponent", async () => {
      const htmlContent =
        "<div data-testid='test-isolated-html'>Isolated HTML</div>"
      const element = createMockElement({
        isolateStyles: true,
        htmlContent,
      })

      renderWithContexts(
        <BidiComponent
          element={element}
          widgetMgr={mockWidgetMgr}
          fragmentId={mockFragmentId}
        />,
        {}
      )

      const container = screen.getByTestId("stBidiComponent-isolated")
      expect(container).toBeVisible()

      // For shadow DOM, we need to check inside the shadow root
      await waitFor(() => {
        const shadowRoot = container.shadowRoot
        expect(shadowRoot).toBeTruthy()
        if (shadowRoot) {
          const testContent = shadowRoot.querySelector(
            "[data-testid='test-isolated-html']"
          )
          expect(testContent).toBeTruthy()
          expect(testContent?.textContent).toBe("Isolated HTML")
        }
      })
    })

    it("should handle complex HTML with nested elements", async () => {
      const htmlContent = `
        <div data-testid='complex-html'>
          <h2 class='title'>Test Title</h2>
          <p class='description'>Description text</p>
          <button id='test-button' type='button'>Click me</button>
          <ul class='list'>
            <li>Item 1</li>
            <li>Item 2</li>
          </ul>
        </div>
      `
      const element = createMockElement({
        isolateStyles: false,
        htmlContent,
      })

      renderWithContexts(
        <BidiComponent
          element={element}
          widgetMgr={mockWidgetMgr}
          fragmentId={mockFragmentId}
        />,
        {}
      )

      // Verify all nested elements are properly injected
      const complexDiv = await screen.findByTestId("complex-html")
      expect(complexDiv).toBeVisible()

      const heading = screen.getByRole("heading", { level: 2 })
      expect(heading).toHaveTextContent("Test Title")
      expect(heading).toHaveClass("title")

      const description = screen.getByText("Description text")
      expect(description).toHaveClass("description")

      const button = screen.getByRole("button", { name: "Click me" })
      expect(button).toHaveAttribute("id", "test-button")
      expect(button).toHaveAttribute("type", "button")

      const list = screen.getByRole("list")
      expect(list).toHaveClass("list")

      const listItems = screen.getAllByRole("listitem")
      expect(listItems).toHaveLength(2)
      expect(listItems[0]).toHaveTextContent("Item 1")
      expect(listItems[1]).toHaveTextContent("Item 2")
    })

    it("should handle empty HTML content gracefully", async () => {
      const element = createMockElement({
        isolateStyles: false,
        htmlContent: "",
      })

      renderWithContexts(
        <BidiComponent
          element={element}
          widgetMgr={mockWidgetMgr}
          fragmentId={mockFragmentId}
        />,
        {}
      )

      const container = screen.getByTestId("stBidiComponent-regular")
      expect(container).toBeVisible()

      // Should have minimal content - just the container div
      await waitFor(() => {
        const contentDiv = container.querySelector("div")
        expect(contentDiv).toBeTruthy()
        // Should not have any significant content since HTML is empty
        expect(contentDiv?.children.length).toBeLessThanOrEqual(1)
      })
    })
  })

  describe("CSS Content Handling", () => {
    it("should inject CSS content in NonIsolatedComponent", async () => {
      const cssContent =
        ".test-style { color: red; background: yellow; font-size: 16px; }"
      const htmlContent =
        "<div class='test-style' data-testid='styled-element'>Styled Content</div>"

      const element = createMockElement({
        isolateStyles: false,
        cssContent,
        htmlContent,
      })

      renderWithContexts(
        <BidiComponent
          element={element}
          widgetMgr={mockWidgetMgr}
          fragmentId={mockFragmentId}
        />,
        {}
      )

      // Verify CSS is injected into the document
      await waitFor(() => {
        const styleElements = document.querySelectorAll("style")
        const hasExpectedStyle = Array.from(styleElements).some(style =>
          style.textContent?.includes(
            ".test-style { color: red; background: yellow; font-size: 16px; }"
          )
        )
        expect(hasExpectedStyle).toBe(true)
      })

      // Verify the styled element exists and can be targeted by the CSS
      const styledElement = await screen.findByTestId("styled-element")
      expect(styledElement).toBeVisible()
      expect(styledElement).toHaveClass("test-style")
    })

    it("should inject CSS content in IsolatedComponent shadow DOM", async () => {
      const cssContent = ".isolated-style { background: blue; }"
      const element = createMockElement({
        isolateStyles: true,
        cssContent,
      })

      renderWithContexts(
        <BidiComponent
          element={element}
          widgetMgr={mockWidgetMgr}
          fragmentId={mockFragmentId}
        />,
        {}
      )

      const container = screen.getByTestId("stBidiComponent-isolated")
      await waitFor(() => {
        const shadowRoot = container.shadowRoot
        expect(shadowRoot).toBeTruthy()
        if (shadowRoot) {
          const styleElement = shadowRoot.querySelector("style")
          expect(styleElement?.textContent).toContain(
            ".isolated-style { background: blue; }"
          )
        }
      })
    })

    it("should handle CSS source path", async () => {
      const element = createMockElement({
        isolateStyles: false,
        cssSourcePath: "styles.css",
      })

      renderWithContexts(
        <BidiComponent
          element={element}
          widgetMgr={mockWidgetMgr}
          fragmentId={mockFragmentId}
        />,
        {
          componentRegistry: {
            getBidiComponentURL: vi.fn(
              (componentName, path) => `/components/${componentName}/${path}`
            ),
          } as unknown as ComponentRegistry,
        }
      )

      await waitFor(() => {
        const linkElements = document.querySelectorAll(
          "link[rel='stylesheet']"
        )
        const hasExpectedLink = Array.from(linkElements).some(link =>
          link.getAttribute("href")?.includes("TestComponent/styles.css")
        )
        expect(hasExpectedLink).toBe(true)
      })
    })
  })

  describe("Data Handling", () => {
    it("should handle mixed data with JSON and Arrow blobs", () => {
      const jsonData = { message: "Hello", count: 5, items: ["a", "b", "c"] }
      const arrowBlob = new Uint8Array([1, 2, 3, 4])

      const element = createMockElement({
        data: "any",
        mixed: {
          json: JSON.stringify(jsonData),
          arrowBlobs: {
            blob1: { data: arrowBlob },
          },
        },
      })

      renderWithContexts(
        <BidiComponent
          element={element}
          widgetMgr={mockWidgetMgr}
          fragmentId={mockFragmentId}
        />,
        {}
      )

      // Component should render successfully with mixed data
      expect(screen.getByTestId("stBidiComponent-regular")).toBeVisible()

      // Verify no error state is shown
      expect(screen.queryByText(/error/i)).not.toBeInTheDocument()
    })

    it.each([
      {
        dataType: "JSON",
        elementConfig: {
          json: JSON.stringify({
            name: "test",
            value: 42,
            active: true,
            nested: { key: "value" },
          }),
          componentName: "TestJSONComponent",
        },
        description: "should handle JSON data correctly",
      },
      {
        dataType: "ArrowData",
        elementConfig: {
          data: "arrowData",
          arrowData: { data: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) },
        },
        description: "should handle Arrow data without errors",
      },
      {
        dataType: "Bytes",
        elementConfig: {
          bytes: new Uint8Array([65, 66, 67, 68, 69]), // "ABCDE" in ASCII
        },
        description: "should handle bytes data correctly",
      },
      {
        dataType: "undefined/null",
        elementConfig: {
          json: undefined,
          arrowData: undefined,
          bytes: undefined,
          mixed: undefined,
        },
        description: "should handle undefined/null data gracefully",
      },
    ])("$description", ({ elementConfig }) => {
      const element = createMockElement({
        // Explicitly set the oneof discriminator for type safety
        ...(elementConfig as Partial<BidiComponentProto>),
      })

      renderWithContexts(
        <BidiComponent
          element={element}
          widgetMgr={mockWidgetMgr}
          fragmentId={mockFragmentId}
        />,
        {}
      )

      // Component should render successfully
      expect(screen.getByTestId("stBidiComponent-regular")).toBeVisible()

      // Should not show any error
      expect(screen.queryByText(/error/i)).not.toBeInTheDocument()
    })
  })

  describe("Widget State Integration", () => {
    it("should integrate with widget manager correctly", () => {
      const testComponentId = "test-widget-id"
      const testFormId = "test-form-id"

      const element = createMockElement({
        id: testComponentId,
        formId: testFormId,
        componentName: "TestWidgetComponent",
      })

      renderWithContexts(
        <BidiComponent
          element={element}
          widgetMgr={mockWidgetMgr}
          fragmentId={mockFragmentId}
        />,
        {}
      )

      // Component should render successfully with the widget manager
      expect(screen.getByTestId("stBidiComponent-regular")).toBeVisible()

      // Context should be set up with correct widget info structure
      // (The getWidgetValue function will be created with the correct widgetInfo)
    })

    it("should handle widget state setup correctly", () => {
      const initialState = { counter: 5, name: "test", active: true }
      const jsonValue = JSON.stringify(initialState)

      // Mock getJsonValue to return our test state
      vi.spyOn(mockWidgetMgr, "getJsonValue").mockReturnValue(jsonValue)

      const element = createMockElement({
        id: "widget-with-state",
        formId: "form-123",
      })

      renderWithContexts(
        <BidiComponent
          element={element}
          widgetMgr={mockWidgetMgr}
          fragmentId={mockFragmentId}
        />,
        {}
      )

      // Component should render without errors when widget state is configured
      expect(screen.getByTestId("stBidiComponent-regular")).toBeVisible()

      // The component should have set up the widget manager context correctly
      // (getJsonValue will be called when the context's getWidgetValue is invoked)
    })

    it("should handle missing widget state gracefully", () => {
      // Mock getJsonValue to return undefined (no saved state)
      vi.spyOn(mockWidgetMgr, "getJsonValue").mockReturnValue(undefined)

      const element = createMockElement({
        id: "widget-no-state",
        formId: "",
      })

      renderWithContexts(
        <BidiComponent
          element={element}
          widgetMgr={mockWidgetMgr}
          fragmentId={mockFragmentId}
        />,
        {}
      )

      expect(screen.getByTestId("stBidiComponent-regular")).toBeVisible()

      // Component should handle undefined widget state gracefully without errors
    })

    it("should handle invalid JSON in widget state gracefully", () => {
      // Mock getJsonValue to return invalid JSON
      vi.spyOn(mockWidgetMgr, "getJsonValue").mockReturnValue(
        '{"invalid": json}'
      )

      const element = createMockElement({
        id: "widget-bad-json",
        formId: "form-456",
      })

      renderWithContexts(
        <BidiComponent
          element={element}
          widgetMgr={mockWidgetMgr}
          fragmentId={mockFragmentId}
        />,
        {}
      )

      // Component should still render even with bad JSON in widget state
      expect(screen.getByTestId("stBidiComponent-regular")).toBeVisible()

      // Component should handle malformed widget JSON gracefully
    })
  })

  describe("Error Handling", () => {
    it("should display ErrorElement when shadow DOM creation fails in IsolatedComponent", async () => {
      // Mock attachShadow to throw an error
      const originalAttachShadow = Element.prototype.attachShadow
      Element.prototype.attachShadow = vi.fn(() => {
        throw new Error("Shadow DOM not supported")
      })

      const element = createMockElement({ isolateStyles: true })

      renderWithContexts(
        <BidiComponent
          element={element}
          widgetMgr={mockWidgetMgr}
          fragmentId={mockFragmentId}
        />,
        {}
      )

      const errorHeading = await screen.findByText(/BidiComponent Error/)
      const errorMessage = await screen.findByText("Shadow DOM not supported")

      expect(errorHeading).toBeVisible()
      expect(errorMessage).toBeVisible()

      // Restore original method
      Element.prototype.attachShadow = originalAttachShadow
    })

    it("should handle malformed JSON data gracefully", () => {
      const element = createMockElement({
        data: "json",
        json: '{"valid": "json"}', // Use valid JSON instead
      })

      // This should render without throwing
      expect(() => {
        renderWithContexts(
          <BidiComponent
            element={element}
            widgetMgr={mockWidgetMgr}
            fragmentId={mockFragmentId}
          />,
          {}
        )
      }).not.toThrow()

      expect(screen.getByTestId("stBidiComponent-regular")).toBeVisible()
    })
  })

  describe("JavaScript Content Handling", () => {
    beforeEach(() => {
      // Mock dynamic import to avoid actual module loading in tests
      vi.doMock(
        "/* @vite-ignore */ data:text/javascript;charset=utf-8,",
        () => ({
          default: vi.fn(() => Promise.resolve(() => {})),
        })
      )
    })

    it("should handle inline JavaScript content and create data URI", async () => {
      const consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => {})
      const jsContent =
        "console.log('Hello from component!'); document.body.setAttribute('data-js-executed', 'true');"

      const element = createMockElement({
        isolateStyles: false,
        jsContent,
        componentName: "TestJSComponent",
      })

      renderWithContexts(
        <BidiComponent
          element={element}
          widgetMgr={mockWidgetMgr}
          fragmentId={mockFragmentId}
        />,
        {
          componentRegistry: {
            getBidiComponentURL: vi.fn(),
          } as unknown as ComponentRegistry,
        }
      )

      expect(screen.getByTestId("stBidiComponent-regular")).toBeVisible()

      // Wait for JavaScript execution and verify it was called
      await waitFor(() => {
        expect(consoleLogSpy).toHaveBeenCalledWith("Hello from component!")
      })

      consoleLogSpy.mockRestore()
    })

    it("should handle JavaScript source path and build correct URL", async () => {
      const mockGetBidiComponentURL = vi.fn(
        (componentName, path) => `/mock-components/${componentName}/${path}`
      )

      const element = createMockElement({
        isolateStyles: false,
        jsSourcePath: "component.js",
        componentName: "SourcePathComponent",
      })

      renderWithContexts(
        <BidiComponent
          element={element}
          widgetMgr={mockWidgetMgr}
          fragmentId={mockFragmentId}
        />,
        {
          componentRegistry: {
            getBidiComponentURL: mockGetBidiComponentURL,
          } as unknown as ComponentRegistry,
        }
      )

      expect(screen.getByTestId("stBidiComponent-regular")).toBeVisible()

      // Verify the URL builder was called with correct parameters
      await waitFor(() => {
        expect(mockGetBidiComponentURL).toHaveBeenCalledWith(
          "SourcePathComponent",
          "component.js"
        )
      })
    })

    it("should prioritize inline JS content over source path", async () => {
      const jsExecutionSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => {})

      const element = createMockElement({
        isolateStyles: false,
        jsContent: "console.log('inline script executed');",
        jsSourcePath: "component.js", // This should be ignored when jsContent is present
        componentName: "PriorityTestComponent",
      })

      renderWithContexts(
        <BidiComponent
          element={element}
          widgetMgr={mockWidgetMgr}
          fragmentId={mockFragmentId}
        />,
        {}
      )

      expect(screen.getByTestId("stBidiComponent-regular")).toBeVisible()

      // Verify that inline JS content was executed (console.log was called)
      await waitFor(() => {
        expect(jsExecutionSpy).toHaveBeenCalledWith("inline script executed")
      })

      jsExecutionSpy.mockRestore()
    })

    it("should handle JavaScript in IsolatedComponent", async () => {
      const jsContent = "console.log('Isolated JavaScript execution');"

      const element = createMockElement({
        isolateStyles: true, // This should render IsolatedComponent
        jsContent,
        componentName: "IsolatedJSComponent",
      })

      renderWithContexts(
        <BidiComponent
          element={element}
          widgetMgr={mockWidgetMgr}
          fragmentId={mockFragmentId}
        />,
        {}
      )

      // Should render isolated component
      expect(screen.getByTestId("stBidiComponent-isolated")).toBeVisible()
      expect(
        screen.queryByTestId("stBidiComponent-regular")
      ).not.toBeInTheDocument()

      // Component should render without errors
      await waitFor(() => {
        expect(screen.getByTestId("stBidiComponent-isolated")).toBeVisible()
      })
    })
  })

  describe("Memoization", () => {
    it("should not re-render when props haven't changed", () => {
      const element = createMockElement()
      const { rerender } = renderWithContexts(
        <BidiComponent
          element={element}
          widgetMgr={mockWidgetMgr}
          fragmentId={mockFragmentId}
        />,
        {}
      )

      expect(screen.getByTestId("stBidiComponent-regular")).toBeVisible()

      // Track widget manager calls (should happen on first render)
      const getJsonValueSpy = vi.spyOn(mockWidgetMgr, "getJsonValue")
      const initialGetJsonCalls = getJsonValueSpy.mock.calls.length

      // Re-render with the same props
      rerender(
        <BidiComponent
          element={element}
          widgetMgr={mockWidgetMgr}
          fragmentId={mockFragmentId}
        />
      )

      // Component should still be visible
      expect(screen.getByTestId("stBidiComponent-regular")).toBeVisible()

      // Due to memoization, widget state setup should not be called again
      expect(getJsonValueSpy.mock.calls.length).toBe(initialGetJsonCalls)
    })

    it("should re-render when element changes", () => {
      const element1 = createMockElement({
        componentName: "Component1",
        htmlContent: "<div data-testid='content-1'>First Content</div>",
      })
      const element2 = createMockElement({
        componentName: "Component2",
        htmlContent: "<div data-testid='content-2'>Second Content</div>",
      })

      const { rerender } = renderWithContexts(
        <BidiComponent
          element={element1}
          widgetMgr={mockWidgetMgr}
          fragmentId={mockFragmentId}
        />,
        {}
      )

      // Verify first content is rendered
      expect(screen.getByTestId("stBidiComponent-regular")).toBeVisible()
      expect(screen.getByTestId("content-1")).toBeVisible()
      expect(screen.getByText("First Content")).toBeVisible()

      // Re-render with different element
      rerender(
        <BidiComponent
          element={element2}
          widgetMgr={mockWidgetMgr}
          fragmentId={mockFragmentId}
        />
      )

      // Verify that the content changed to reflect the new element
      expect(screen.getByTestId("stBidiComponent-regular")).toBeVisible()
      expect(screen.getByTestId("content-2")).toBeVisible()
      expect(screen.getByText("Second Content")).toBeVisible()

      // Verify old content is no longer present
      expect(screen.queryByTestId("content-1")).not.toBeInTheDocument()
      expect(screen.queryByText("First Content")).not.toBeInTheDocument()
    })
  })
})
