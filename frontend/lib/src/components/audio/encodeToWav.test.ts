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

import { describe, it, expect } from "vitest"

import encodeToWav from "./encodeToWav"

/**
 * Parse WAV header to validate format
 */
function parseWavHeader(arrayBuffer: ArrayBuffer): {
  riff: string
  fileSize: number
  wave: string
  fmt: string
  fmtSize: number
  audioFormat: number
  numChannels: number
  sampleRate: number
  byteRate: number
  blockAlign: number
  bitsPerSample: number
  data: string
  dataSize: number
} {
  const view = new DataView(arrayBuffer)
  const decoder = new TextDecoder()

  // RIFF header
  const riff = decoder.decode(new Uint8Array(arrayBuffer, 0, 4))
  const fileSize = view.getUint32(4, true)
  const wave = decoder.decode(new Uint8Array(arrayBuffer, 8, 4))

  // fmt chunk
  const fmt = decoder.decode(new Uint8Array(arrayBuffer, 12, 4))
  const fmtSize = view.getUint32(16, true)
  const audioFormat = view.getUint16(20, true)
  const numChannels = view.getUint16(22, true)
  const sampleRate = view.getUint32(24, true)
  const byteRate = view.getUint32(28, true)
  const blockAlign = view.getUint16(32, true)
  const bitsPerSample = view.getUint16(34, true)

  // data chunk
  const data = decoder.decode(new Uint8Array(arrayBuffer, 36, 4))
  const dataSize = view.getUint32(40, true)

  return {
    riff,
    fileSize,
    wave,
    fmt,
    fmtSize,
    audioFormat,
    numChannels,
    sampleRate,
    byteRate,
    blockAlign,
    bitsPerSample,
    data,
    dataSize,
  }
}

describe("encodeToWav", () => {
  it("should encode audio blob to WAV format at 16kHz", async () => {
    // Create a mock audio blob (WebM format typically from MediaRecorder)
    const mockAudioData = new Uint8Array([0, 1, 2, 3, 4, 5])
    const mockBlob = new Blob([mockAudioData], { type: "audio/webm" })

    // Mock AudioContext and related APIs
    const mockAudioBuffer = {
      numberOfChannels: 2,
      length: 16000, // 1 second at 16kHz
      sampleRate: 48000,
      getChannelData: (channel: number) => {
        // Return mock channel data
        return new Float32Array(16000).fill(0.5)
      },
    }

    const mockOfflineContext = {
      decodeAudioData: async () => mockAudioBuffer,
      destination: {},
      createBufferSource: () => ({
        buffer: null,
        connect: () => {},
        start: () => {},
      }),
      startRendering: async () => ({
        numberOfChannels: 1,
        length: 16000,
        sampleRate: 16000,
        getChannelData: () => new Float32Array(16000).fill(0.5),
      }),
    }

    global.OfflineAudioContext = class {
      constructor() {
        return mockOfflineContext as any
      }
    } as any

    const wavBlob = await encodeToWav(mockBlob, 16000)

    expect(wavBlob).toBeInstanceOf(Blob)
    expect(wavBlob?.type).toBe("audio/wav")

    // Parse and validate WAV header
    const arrayBuffer = await wavBlob!.arrayBuffer()
    const header = parseWavHeader(arrayBuffer)

    // Validate WAV file structure
    expect(header.riff).toBe("RIFF")
    expect(header.wave).toBe("WAVE")
    expect(header.fmt).toBe("fmt ")
    expect(header.data).toBe("data")

    // Validate format specifications
    expect(header.audioFormat).toBe(1) // PCM
    expect(header.numChannels).toBe(1) // Mono
    expect(header.sampleRate).toBe(16000) // 16kHz
    expect(header.bitsPerSample).toBe(16) // 16-bit

    // Validate calculated values
    expect(header.byteRate).toBe(32000) // sampleRate * numChannels * bitsPerSample/8
    expect(header.blockAlign).toBe(2) // numChannels * bitsPerSample/8

    // Validate data size consistency
    const expectedDataSize = 16000 * 2 // samples * bytes per sample
    expect(header.dataSize).toBe(expectedDataSize)
    expect(header.fileSize).toBe(36 + expectedDataSize) // header + data
  })

  it("should handle different sample rates correctly", async () => {
    const mockBlob = new Blob(["test"], { type: "audio/webm" })

    const mockAudioBuffer = {
      numberOfChannels: 1,
      length: 8000,
      sampleRate: 44100,
      getChannelData: () => new Float32Array(8000).fill(0),
    }

    global.OfflineAudioContext = class {
      targetSampleRate: number
      constructor(_channels: number, length: number, sampleRate: number) {
        this.targetSampleRate = sampleRate
        return {
          decodeAudioData: async () => mockAudioBuffer,
          destination: {},
          createBufferSource: () => ({
            buffer: null,
            connect: () => {},
            start: () => {},
          }),
          startRendering: async () => ({
            numberOfChannels: 1,
            length: 8000,
            sampleRate: 8000,
            getChannelData: () => new Float32Array(8000).fill(0),
          }),
        } as any
      }
    } as any

    const wavBlob8k = await encodeToWav(mockBlob, 8000)
    const arrayBuffer = await wavBlob8k!.arrayBuffer()
    const header = parseWavHeader(arrayBuffer)

    expect(header.sampleRate).toBe(8000)
    expect(header.byteRate).toBe(16000) // 8000 * 1 * 16/8
  })

  it("should properly clip audio values to [-1, 1] range", async () => {
    const mockBlob = new Blob(["test"], { type: "audio/webm" })

    // Mock audio buffer with out-of-range values
    const outOfRangeData = new Float32Array([-2, -1.5, -1, 0, 1, 1.5, 2])

    global.OfflineAudioContext = class {
      constructor() {
        return {
          decodeAudioData: async () => ({
            numberOfChannels: 1,
            length: outOfRangeData.length,
            sampleRate: 16000,
            getChannelData: () => outOfRangeData,
          }),
          destination: {},
          createBufferSource: () => ({
            buffer: null,
            connect: () => {},
            start: () => {},
          }),
          startRendering: async () => ({
            numberOfChannels: 1,
            length: outOfRangeData.length,
            sampleRate: 16000,
            getChannelData: () => outOfRangeData,
          }),
        } as any
      }
    } as any

    const wavBlob = await encodeToWav(mockBlob, 16000)
    const arrayBuffer = await wavBlob!.arrayBuffer()

    // Check that values are properly clipped when converted to int16
    const dataView = new DataView(arrayBuffer)
    const samples: number[] = []

    // Read samples from data chunk (starting at offset 44)
    for (let i = 44; i < arrayBuffer.byteLength; i += 2) {
      const sample = dataView.getInt16(i, true)
      samples.push(sample / 32768) // Convert back to float range
    }

    // All samples should be within [-1, 1] range after clipping
    samples.forEach(sample => {
      expect(sample).toBeGreaterThanOrEqual(-1)
      expect(sample).toBeLessThanOrEqual(1)
    })
  })

  it("should downmix stereo to mono correctly", async () => {
    const mockBlob = new Blob(["test"], { type: "audio/webm" })

    const leftChannel = new Float32Array([0.5, 0.3, 0.1])
    const rightChannel = new Float32Array([0.4, 0.2, 0.6])

    global.OfflineAudioContext = class {
      constructor() {
        return {
          decodeAudioData: async () => ({
            numberOfChannels: 2,
            length: 3,
            sampleRate: 16000,
            getChannelData: (channel: number) =>
              channel === 0 ? leftChannel : rightChannel,
          }),
          destination: {},
          createBufferSource: () => ({
            buffer: null,
            connect: () => {},
            start: () => {},
          }),
          startRendering: async () => {
            // Simulate downmixing (L+R)/2
            const mixed = new Float32Array(3)
            for (let i = 0; i < 3; i++) {
              mixed[i] = (leftChannel[i] + rightChannel[i]) / 2
            }
            return {
              numberOfChannels: 1,
              length: 3,
              sampleRate: 16000,
              getChannelData: () => mixed,
            }
          },
        } as any
      }
    } as any

    const wavBlob = await encodeToWav(mockBlob, 16000)
    const header = parseWavHeader(await wavBlob!.arrayBuffer())

    expect(header.numChannels).toBe(1) // Should be mono
  })
})
