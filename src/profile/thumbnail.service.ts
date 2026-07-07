import { Injectable, Logger } from '@nestjs/common'
import { createCanvas } from 'canvas'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf'

const THUMBNAIL_SCALE = 0.5   // renders at 50% of original — good balance of quality vs size
const THUMBNAIL_CONTENT_TYPE = 'image/png'

@Injectable()
export class ThumbnailService {
  private readonly logger = new Logger(ThumbnailService.name)

  async generateFromPdfBuffer(pdfBuffer: Buffer): Promise<Buffer> {
    const data = new Uint8Array(pdfBuffer)

    const doc = await pdfjs.getDocument({
      data,
      // Disable worker in Node.js — runs in main thread
      isEvalSupported: false,
      useSystemFonts: true,
    }).promise

    const page = await doc.getPage(1)
    const viewport = page.getViewport({ scale: THUMBNAIL_SCALE })

    const canvas = createCanvas(Math.floor(viewport.width), Math.floor(viewport.height))
    const ctx = canvas.getContext('2d')

    await page.render({
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise

    await doc.destroy()

    return canvas.toBuffer(THUMBNAIL_CONTENT_TYPE)
  }

  get contentType() {
    return THUMBNAIL_CONTENT_TYPE
  }
}
