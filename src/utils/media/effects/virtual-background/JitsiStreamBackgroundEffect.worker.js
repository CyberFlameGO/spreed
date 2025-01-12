import createTFLiteModule from './vendor/tflite/tflite'
import createTFLiteSIMDModule from './vendor/tflite/tflite-simd'
import withoutSIMD from './vendor/tflite/tflite.wasm'
import withSIMD from './vendor/tflite/tflite-simd.wasm'
import v681 from './vendor/models/segm_lite_v681.tflite'
import v679 from './vendor/models/segm_full_v679.tflite'

const models = {
	model96: v681.split('/').pop(),
	model144: v679.split('/').pop(),
}

self.compiled = false

self.onmessage = (e) => {
	const message = e.data.message
	switch (message) {
	case 'makeTFLite':
		self.segmentationPixelCount = e.data.segmentationPixelCount
		makeTFLite(e.data.simd)
		break
	case 'resizeSource':
		if (!self.compiled) return
		resizeSource(e.data.imageData)
		break
	case 'runInference':
		runInference()
		break
	default:
		console.error('JitsiStreamBackgroundEffect.worker: Message unknown.')
		console.error(message)
		break
	}
}

/**
 * @param {boolean} isSimd whether WebAssembly SIMD is available or not
 */
async function makeTFLite(isSimd) {
	try {
		switch (isSimd) {
		case true:
			self.wasmUrl = withSIMD.split('/').pop()
			self.tflite = await createTFLiteSIMDModule({ locateFile: (path) => { return self.wasmUrl } })
			break
		case false:
			self.wasmUrl = withoutSIMD.split('/').pop()
			self.tflite = await createTFLiteModule({ locateFile: (path) => { return self.wasmUrl } })
			break
		default:
			return
		}
		self.modelBufferOffset = self.tflite._getModelBufferMemoryOffset()
		self.modelResponse = await fetch(isSimd === true ? models.model144 : models.model96)

		if (!self.modelResponse.ok) {
			throw new Error('Failed to download tflite model!')
		}
		self.model = await self.modelResponse.arrayBuffer()

		self.tflite.HEAPU8.set(new Uint8Array(self.model), self.modelBufferOffset)

		await self.tflite._loadModel(self.model.byteLength)

		self.compiled = true

		self.postMessage({ message: 'loaded' })

	} catch (error) {
		console.error(error)
		console.error('JitsiStreamBackgroundEffect.worker: tflite compilation failed.')
	}
}

/**
 * @param {ImageData} imageData the image data from the canvas
 */
function resizeSource(imageData) {
	const inputMemoryOffset = self.tflite._getInputMemoryOffset() / 4
	for (let i = 0; i < self.segmentationPixelCount; i++) {
		self.tflite.HEAPF32[inputMemoryOffset + (i * 3)] = imageData.data[i * 4] / 255
		self.tflite.HEAPF32[inputMemoryOffset + (i * 3) + 1] = imageData.data[(i * 4) + 1] / 255
		self.tflite.HEAPF32[inputMemoryOffset + (i * 3) + 2] = imageData.data[(i * 4) + 2] / 255
	}
	runInference()
}

/**
 *
 */
function runInference() {
	self.tflite._runInference()
	const outputMemoryOffset = self.tflite._getOutputMemoryOffset() / 4
	const segmentationMaskData = []
	// All consts in Worker in obj array.
	for (let i = 0; i < self.segmentationPixelCount; i++) {

		const background = self.tflite.HEAPF32[outputMemoryOffset + (i * 2)]
		const person = self.tflite.HEAPF32[outputMemoryOffset + (i * 2) + 1]
		const shift = Math.max(background, person)

		segmentationMaskData.push({
			background,
			person,
			shift,
			backgroundExp: Math.exp(background - shift),
			personExp: Math.exp(person - shift),
		})
	}
	self.postMessage({ message: 'inferenceRun', segmentationResult: segmentationMaskData })
}

// This is needed to make the linter happy, but even if nothing is actually
// exported the worker is loaded as expected.
export default null
