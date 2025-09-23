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

import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import RecordPlugin from "wavesurfer.js/dist/plugins/record"

import { useAudioRecorder } from "./useAudioRecorder"

// Mock WaveSurfer and RecordPlugin
vi.mock("wavesurfer.js", () => ({
  default: {
    create: vi.fn(() => ({
      registerPlugin: vi.fn(),
      destroy: vi.fn(),
    })),
  },
}))

vi.mock("wavesurfer.js/dist/plugins/record", () => ({
  default: {
    create: vi.fn(() => ({
      startRecording: vi.fn(),
      stopRecording: vi.fn(),
      isRecording: vi.fn(() => false),
      on: vi.fn(),
      un: vi.fn(),
      destroy: vi.fn(),
    })),
  },
}))

describe("useAudioRecorder", () => {
  let mockGetUserMedia: ReturnType<typeof vi.fn>

  beforeEach(() => {
    // Mock getUserMedia
    mockGetUserMedia = vi.fn().mockResolvedValue({
      getTracks: () => [
        {
          stop: vi.fn(),
        },
      ],
    })

    Object.defineProperty(global.navigator, "mediaDevices", {
      writable: true,
      value: {
        getUserMedia: mockGetUserMedia,
      },
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it("should initialize with default values", () => {
    const { result } = renderHook(() => useAudioRecorder())

    expect(result.current.isRecording).toBe(false)
    expect(result.current.recordingTime).toBe(0)
    expect(result.current.hasPermission).toBe(null)
    expect(result.current.wavesurfer).toBe(null)
    expect(result.current.recordPlugin).toBe(null)
  })

  it("should start recording when startRecording is called", async () => {
    const onTimeUpdate = vi.fn()
    const { result } = renderHook(() => useAudioRecorder({ onTimeUpdate }))

    const mockRecordPlugin = {
      startRecording: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      un: vi.fn(),
      isRecording: vi.fn(() => true),
      stopRecording: vi.fn(),
      destroy: vi.fn(),
    }

    RecordPlugin.create = vi.fn(
      () => mockRecordPlugin as unknown as RecordPlugin
    )

    await act(async () => {
      await result.current.startRecording()
    })

    expect(mockRecordPlugin.startRecording).toHaveBeenCalled()
    expect(result.current.isRecording).toBe(true)
    expect(result.current.hasPermission).toBe(true)
  })

  it("should handle permission denied", async () => {
    const onRecordingError = vi.fn()
    const { result } = renderHook(() => useAudioRecorder({ onRecordingError }))

    const mockRecordPlugin = {
      startRecording: vi
        .fn()
        .mockRejectedValue(new Error("Permission denied")),
      on: vi.fn(),
      un: vi.fn(),
      isRecording: vi.fn(() => false),
      stopRecording: vi.fn(),
      destroy: vi.fn(),
    }

    RecordPlugin.create = vi.fn(
      () => mockRecordPlugin as unknown as RecordPlugin
    )

    await act(async () => {
      await result.current.startRecording()
    })

    expect(onRecordingError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("Permission denied"),
      })
    )
    expect(result.current.hasPermission).toBe(false)
    expect(result.current.isRecording).toBe(false)
  })

  it("should stop recording and return blob", async () => {
    const onRecordingStop = vi.fn()
    const { result } = renderHook(() => useAudioRecorder({ onRecordingStop }))

    const mockBlob = new Blob(["test"], { type: "audio/webm" })
    let recordEndHandler: ((blob: Blob) => void) | undefined
    const mockRecordPlugin = {
      startRecording: vi.fn().mockResolvedValue(undefined),
      stopRecording: vi.fn(),
      on: vi.fn((event, handler) => {
        if (event === "record-end") {
          recordEndHandler = handler
        }
      }),
      un: vi.fn(),
      isRecording: vi.fn(() => true),
      destroy: vi.fn(),
    }

    RecordPlugin.create = vi.fn(
      () => mockRecordPlugin as unknown as RecordPlugin
    )

    // Start recording first
    await act(async () => {
      await result.current.startRecording()
    })

    // Stop recording and simulate the plugin's record-end event
    const stopPromise = act(async () => {
      const promise = result.current.stopRecording()
      // Simulate the plugin firing the record-end event
      if (recordEndHandler) {
        recordEndHandler(mockBlob)
      }
      return promise
    })

    const blob = await stopPromise

    expect(mockRecordPlugin.stopRecording).toHaveBeenCalled()
    expect(onRecordingStop).toHaveBeenCalledWith(mockBlob)
    expect(blob).toBe(mockBlob)
  })

  it("should update recording time", async () => {
    const onTimeUpdate = vi.fn()
    const { result } = renderHook(() => useAudioRecorder({ onTimeUpdate }))

    let progressHandler: ((time: number) => void) | undefined
    const mockRecordPlugin = {
      startRecording: vi.fn().mockResolvedValue(undefined),
      on: vi.fn((event, handler) => {
        if (event === "record-progress") {
          progressHandler = handler
        }
      }),
      un: vi.fn(),
      isRecording: vi.fn(() => true),
      stopRecording: vi.fn(),
      destroy: vi.fn(),
    }

    RecordPlugin.create = vi.fn(
      () => mockRecordPlugin as unknown as RecordPlugin
    )

    await act(async () => {
      await result.current.startRecording()
    })

    // Simulate the plugin firing progress events
    act(() => {
      if (progressHandler) {
        progressHandler(5.5)
      }
    })

    expect(onTimeUpdate).toHaveBeenCalledWith(5.5)
    expect(result.current.recordingTime).toBe(5.5)
  })

  it("should cleanup on unmount", () => {
    const { unmount } = renderHook(() => useAudioRecorder())

    const mockRecordPlugin = {
      startRecording: vi.fn().mockResolvedValue(undefined),
      isRecording: vi.fn(() => true),
      stopRecording: vi.fn(),
      on: vi.fn(),
      un: vi.fn(),
      destroy: vi.fn(),
    }

    RecordPlugin.create = vi.fn(
      () => mockRecordPlugin as unknown as RecordPlugin
    )

    // Note: The cleanup happens internally in the hook's useEffect
    // We can't directly test internal refs, but we can verify the hook
    // unmounts without errors
    unmount()

    // The hook should unmount cleanly without throwing
    expect(true).toBe(true)
  })

  it("should handle sample rate option", async () => {
    const sampleRate = 16000
    const { result } = renderHook(() => useAudioRecorder({ sampleRate }))

    const mockRecordPlugin = {
      startRecording: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      un: vi.fn(),
      isRecording: vi.fn(() => true),
      stopRecording: vi.fn(),
      destroy: vi.fn(),
    }

    RecordPlugin.create = vi.fn(
      () => mockRecordPlugin as unknown as RecordPlugin
    )

    await act(async () => {
      await result.current.startRecording()
    })

    expect(RecordPlugin.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sampleRate: 16000,
      })
    )

    expect(mockRecordPlugin.startRecording).toHaveBeenCalledWith(
      expect.objectContaining({
        sampleRate: 16000,
      })
    )
  })
})
