import { FocusStacker } from './focus-stack'

/**
 * Merges a focus stack off the main thread, so the live picture keeps running while the pictures
 * come in (see `./focus-stack.ts` and `stores/focus-stack.ts`).
 */

export type StackRequest =
  { type: 'frame'; width: number; height: number; data: ArrayBuffer } | { type: 'finish' }

export type StackResponse =
  | { type: 'added'; count: number }
  | { type: 'result'; width: number; height: number; data: ArrayBuffer; unaligned: number }
  | { type: 'error'; message: string }

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<StackRequest>) => void) | null
  postMessage(message: StackResponse, transfer?: Transferable[]): void
}

let stacker: FocusStacker | null = null

scope.onmessage = ({ data: request }) => {
  try {
    if (request.type === 'frame') {
      // A picture of another size (other camera, resolution) cannot be merged with the others.
      if (stacker && (stacker.width !== request.width || stacker.height !== request.height)) return
      stacker ??= new FocusStacker(request.width, request.height)
      stacker.add(new Uint8ClampedArray(request.data))
      scope.postMessage({ type: 'added', count: stacker.count })
    } else {
      if (!stacker) throw new Error('Es wurde kein Bild aufgenommen.')
      const { width, height, rgba } = stacker.result()
      const data = rgba.buffer as ArrayBuffer
      scope.postMessage({ type: 'result', width, height, data, unaligned: stacker.unaligned }, [
        data
      ])
      stacker = null
    }
  } catch (err) {
    scope.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
