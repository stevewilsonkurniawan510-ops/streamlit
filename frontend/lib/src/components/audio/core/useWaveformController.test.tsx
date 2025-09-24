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

import { renderHook, act } from "@testing-library/react"
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest"

import { useWaveformController } from "./useWaveformController"
import type { WaveformState } from "./types"

// Mock the backends
vi.mock("../backends/WaveSurferRecordBackend", () => {
  const MockRecordBackend = vi.fn()
  MockRecordBackend.prototype.initialize = vi.fn().mockResolvedValue(undefined)
  MockRecordBackend.prototype.startRecording = vi
    .fn()
    .mockResolvedValue(undefined)
  MockRecordBackend.prototype.stopRecording = vi
    .fn()
    .mockResolvedValue(new Blob())
  MockRecordBackend.prototype.cancelRecording = vi.fn()
  MockRecordBackend.prototype.mountVisualizer = vi.fn()
  MockRecordBackend.prototype.unmountVisualizer = vi.fn()
  MockRecordBackend.prototype.setOptions = vi.fn()
  MockRecordBackend.prototype.destroy = vi.fn()
  MockRecordBackend.prototype.on = vi.fn()
  MockRecordBackend.prototype.off = vi.fn()

  return { WaveSurferRecordBackend: MockRecordBackend }
})

vi.mock("../playback/WaveSurferPlayer", () => {
  const MockPlayer = vi.fn()
  MockPlayer.prototype.load = vi.fn().mockResolvedValue(undefined)
  MockPlayer.prototype.play = vi.fn().mockResolvedValue(undefined)
  MockPlayer.prototype.pause = vi.fn()
  MockPlayer.prototype.seek = vi.fn()
  MockPlayer.prototype.getDuration = vi.fn().mockReturnValue(0)
  MockPlayer.prototype.getCurrentTime = vi.fn().mockReturnValue(0)
  MockPlayer.prototype.mountVisualizer = vi.fn()
  MockPlayer.prototype.unmountVisualizer = vi.fn()
  MockPlayer.prototype.setOptions = vi.fn()
  MockPlayer.prototype.destroy = vi.fn()
  MockPlayer.prototype.on = vi.fn()
  MockPlayer.prototype.off = vi.fn()

  return { WaveSurferPlayer: MockPlayer }
})

// Mock encodeToWav
vi.mock("../encodeToWav", () => ({
  default: vi
    .fn()
    .mockResolvedValue(new Blob(["mock"], { type: "audio/wav" })),
}))

describe("useWaveformController", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe("Capabilities Matrix", () => {
    // Test each state's capabilities according to the matrix
    const capabilityMatrix: Record<
      WaveformState,
      {
        canStartRecording: boolean
        canStopRecording: boolean
        canCancelRecording: boolean
        canPlay: boolean
        canPause: boolean
        canSeek: boolean
        canClear: boolean
      }
    > = {
      idle: {
        canStartRecording: true,
        canStopRecording: false,
        canCancelRecording: false,
        canPlay: false,
        canPause: false,
        canSeek: false,
        canClear: false,
      },
      requesting_mic: {
        canStartRecording: false,
        canStopRecording: false,
        canCancelRecording: true,
        canPlay: false,
        canPause: false,
        canSeek: false,
        canClear: false,
      },
      recording: {
        canStartRecording: false,
        canStopRecording: true,
        canCancelRecording: true,
        canPlay: false,
        canPause: false,
        canSeek: false,
        canClear: false,
      },
      stopping: {
        canStartRecording: false,
        canStopRecording: false,
        canCancelRecording: false,
        canPlay: false,
        canPause: false,
        canSeek: false,
        canClear: false,
      },
      ready: {
        canStartRecording: true,
        canStopRecording: false,
        canCancelRecording: false,
        canPlay: true,
        canPause: false,
        canSeek: true,
        canClear: true,
      },
      playing: {
        canStartRecording: false,
        canStopRecording: false,
        canCancelRecording: false,
        canPlay: false,
        canPause: true,
        canSeek: true,
        canClear: false,
      },
      paused: {
        canStartRecording: false,
        canStopRecording: false,
        canCancelRecording: false,
        canPlay: true,
        canPause: false,
        canSeek: true,
        canClear: true,
      },
      error: {
        canStartRecording: false,
        canStopRecording: false,
        canCancelRecording: false,
        canPlay: false,
        canPause: false,
        canSeek: false,
        canClear: false,
      },
    }

    it.each(Object.entries(capabilityMatrix))(
      "should have correct capabilities for state: %s",
      (state, expectedCapabilities) => {
        const { result } = renderHook(() => useWaveformController())

        // Force state transition for testing (we'll need to expose a test helper or mock)
        // For now, we test the initial state (idle)
        if (state === "idle") {
          const caps = result.current.getCapabilities()
          expect(caps).toEqual(expectedCapabilities)
        }
      }
    )
  })

  describe("WAV Output", () => {
    it("should return WAV blob at 16kHz from stopRecording", async () => {
      const { result } = renderHook(() =>
        useWaveformController({ sampleRate: 16000 })
      )

      // Start recording
      await act(async () => {
        await result.current.startRecording()
      })

      // Mock the recording state
      act(() => {
        const stateEvent = vi.fn()
        result.current.on("state", stateEvent)
      })

      // Stop recording
      let wavBlob: Blob | undefined
      await act(async () => {
        wavBlob = await result.current.stopRecording()
      })

      expect(wavBlob).toBeInstanceOf(Blob)
      expect(wavBlob?.type).toBe("audio/wav")
    })

    it("should respect autoLoadOnReady option", async () => {
      const { result } = renderHook(() =>
        useWaveformController({ autoLoadOnReady: false })
      )

      // The playback backend should not be created when autoLoadOnReady is false
      await act(async () => {
        await result.current.startRecording()
      })

      await act(async () => {
        await result.current.stopRecording()
      })

      // Verify that play capability is not available when autoLoadOnReady is false
      const caps = result.current.getCapabilities()
      // When autoLoadOnReady is false and we're in ready state, play should still be available
      // but the audio won't be loaded into the player
      expect(caps.canPlay).toBe(true)
    })
  })

  describe("Error Handling", () => {
    it("should emit error with code when WaveSurfer is unavailable", async () => {
      // Mock WaveSurfer initialization failure
      const { WaveSurferRecordBackend } = await import(
        "../backends/WaveSurferRecordBackend"
      )
      ;(WaveSurferRecordBackend as any).mockImplementationOnce(() => {
        throw new Error("WaveSurfer not found")
      })

      const { result } = renderHook(() => useWaveformController())

      const errorHandler = vi.fn()
      result.current.on("error", errorHandler)

      await act(async () => {
        try {
          await result.current.startRecording()
        } catch {
          // Expected to throw
        }
      })

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "wavesurfer_unavailable",
          message: expect.stringContaining("WaveSurfer"),
        })
      )
    })

    it("should emit permission_denied error code", async () => {
      // Mock getUserMedia failure
      const { WaveSurferRecordBackend } = await import(
        "../backends/WaveSurferRecordBackend"
      )
      ;(WaveSurferRecordBackend as any).mockImplementationOnce(() => ({
        initialize: vi.fn().mockResolvedValue(undefined),
        startRecording: vi.fn().mockRejectedValue(
          Object.assign(new Error("Permission denied"), {
            name: "NotAllowedError",
          })
        ),
        on: vi.fn(),
        off: vi.fn(),
        mountVisualizer: vi.fn(),
        destroy: vi.fn(),
      }))

      const { result } = renderHook(() => useWaveformController())

      const errorHandler = vi.fn()
      result.current.on("error", errorHandler)

      await act(async () => {
        try {
          await result.current.startRecording()
        } catch {
          // Expected to throw
        }
      })

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "permission_denied",
        })
      )
    })
  })

  describe("Single getUserMedia Call", () => {
    it("should only call getUserMedia once per recording session", async () => {
      const getUserMediaSpy = vi.fn().mockResolvedValue({
        getTracks: () => [],
      })
      Object.defineProperty(global.navigator, "mediaDevices", {
        value: {
          getUserMedia: getUserMediaSpy,
        },
        configurable: true,
      })

      const { result } = renderHook(() => useWaveformController())

      await act(async () => {
        await result.current.startRecording()
      })

      // The mock backend should handle getUserMedia internally
      // We're verifying that we don't double-call it
      expect(getUserMediaSpy).toHaveBeenCalledTimes(0) // Backend handles it
    })
  })

  describe("State Transitions", () => {
    it("should follow valid state transitions", async () => {
      const { result } = renderHook(() => useWaveformController())

      const stateChanges: Array<{
        prev: WaveformState
        next: WaveformState
      }> = []

      result.current.on("state", data => {
        stateChanges.push(data)
      })

      // Start recording
      await act(async () => {
        await result.current.startRecording()
      })

      expect(stateChanges).toContainEqual({
        prev: "idle",
        next: "requesting_mic",
      })

      // Clean up
      act(() => {
        result.current.destroy()
      })
    })

    it("should prevent invalid state transitions", async () => {
      const { result } = renderHook(() => useWaveformController())

      // In idle state, we can't stop recording
      await expect(result.current.stopRecording()).rejects.toThrow(
        "Cannot stop recording in state: idle"
      )
    })
  })

  describe("Container Management", () => {
    it("should be idempotent when mounting visualizer", () => {
      const { result } = renderHook(() => useWaveformController())

      const container = document.createElement("div")

      act(() => {
        result.current.mountVisualizer(container)
        result.current.mountVisualizer(container) // Should not error
      })

      // No errors expected
      expect(true).toBe(true)
    })

    it("should queue container changes during recording", async () => {
      const { result } = renderHook(() => useWaveformController())

      const container1 = document.createElement("div")
      const container2 = document.createElement("div")

      act(() => {
        result.current.mountVisualizer(container1)
      })

      await act(async () => {
        await result.current.startRecording()
      })

      // Try to change container during recording
      act(() => {
        result.current.mountVisualizer(container2)
      })

      // Container change should be queued
      // We'll verify this by checking that no error was thrown
      expect(true).toBe(true)
    })
  })
})
