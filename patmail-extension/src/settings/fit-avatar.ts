import { centerCropRect, MAX_AVATAR_DATA_URL } from './avatar'

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const MAX_FILE_BYTES = 8 * 1024 * 1024

const SIZES = [512, 384, 256, 192]

/** 居中裁成正方形，压成 WebP 放进浏览器缓存。透明底会留下来。 */
export async function fitAvatarBlob(file: File): Promise<Blob> {
  return fitAvatar(file, async (canvas, quality) => {
    const blob = await canvasToBlob(canvas, quality)
    return blob.size > 0 && blob.size <= 700_000 ? blob : null
  })
}

/** 缓存不可用时才把小图收成 data URL。 */
export async function fitAvatarFile(file: File): Promise<string> {
  return fitAvatar(file, async (canvas, quality) => {
    const image = canvas.toDataURL('image/webp', quality)
    return image.length <= MAX_AVATAR_DATA_URL ? image : null
  })
}

async function fitAvatar<T>(file: File, accept: (canvas: HTMLCanvasElement, quality: number) => Promise<T | null>): Promise<T> {
  if (!ALLOWED.has(file.type)) throw new Error('请选择 jpg、png、webp 或 gif 图片。')
  if (file.size <= 0 || file.size > MAX_FILE_BYTES) throw new Error('图片需要小于 8MB。')
  const bitmap = await createImageBitmap(file)
  try {
    for (const edge of SIZES) {
      const canvas = drawSquare(bitmap, edge)
      for (const quality of [0.86, 0.72, 0.6]) {
        const accepted = await accept(canvas, quality)
        if (accepted) return accepted
      }
    }
    throw new Error('这张图压完还是太大，换一张再试。')
  } finally {
    bitmap.close()
  }
}

function drawSquare(bitmap: ImageBitmap, edge: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = edge
  canvas.height = edge
  const context = canvas.getContext('2d')
  if (!context) throw new Error('当前页面画不了头像。')
  const crop = centerCropRect(bitmap.width, bitmap.height)
  context.clearRect(0, 0, edge, edge)
  context.drawImage(bitmap, crop.sx, crop.sy, crop.side, crop.side, 0, 0, edge, edge)
  return canvas
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob)
      else reject(new Error('当前页面压不了头像。'))
    }, 'image/webp', quality)
  })
}
