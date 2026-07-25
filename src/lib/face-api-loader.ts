// Models hosted on the official face-api.js CDN (vladmandic mirror is also valid)
const MODEL_URL = "https://justadudewhohacks.github.io/face-api.js/models";

type FaceApiModule = typeof import("face-api.js");

let faceApiPromise: Promise<FaceApiModule> | null = null;
let loadingPromise: Promise<void> | null = null;

async function getFaceApi(): Promise<FaceApiModule> {
  if (typeof window === "undefined") {
    throw new Error("El reconocimiento facial solo está disponible en el navegador.");
  }
  if (!faceApiPromise) {
    faceApiPromise = import("face-api.js");
  }
  return faceApiPromise;
}

export async function loadFaceModels(): Promise<void> {
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    const faceapi = await getFaceApi();
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]);
  })();
  return loadingPromise;
}

export async function getFaceDescriptor(
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  opts: { inputSize?: number; scoreThreshold?: number } = {},
) {
  const faceapi = await getFaceApi();
  const detection = await faceapi
    .detectSingleFace(
      input,
      new faceapi.TinyFaceDetectorOptions({
        inputSize: opts.inputSize ?? 224,
        scoreThreshold: opts.scoreThreshold ?? 0.45,
      }),
    )
    .withFaceLandmarks()
    .withFaceDescriptor();
  return detection ?? null;
}

export function euclideanDistance(a: Float32Array | number[], b: Float32Array | number[]) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = (a[i] as number) - (b[i] as number);
    sum += d * d;
  }
  return Math.sqrt(sum);
}

// Match if distance below this; relaxed from 0.55 for varied lighting in stores
export const FACE_MATCH_THRESHOLD = 0.5;

export function descriptorToArray(d: Float32Array): number[] {
  return Array.from(d);
}
