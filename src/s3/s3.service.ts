import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3'
import { Readable } from 'stream'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name)
  private readonly client: S3Client
  private readonly bucket: string
  private readonly prefix: string

  constructor(private readonly configService: ConfigService) {
    const region = this.configService.get<string>('AWS_REGION') || 'us-east-1'
    const endpointUrl = this.configService.get<string>('AWS_ENDPOINT_URL')
    const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID') || 'test'
    const secretAccessKey = this.configService.get<string>('AWS_SECRET_ACCESS_KEY') || 'test'

    this.bucket = this.configService.get<string>('S3_BUCKET') || 'jobblitz-dev'
    this.prefix = this.configService.get<string>('S3_PREFIX') || 'resumes'

    this.client = new S3Client({
      region,
      credentials: { accessKeyId, secretAccessKey },
      ...(endpointUrl && {
        endpoint: endpointUrl,
        forcePathStyle: true,
      }),
    })
  }

  /**
   * Deterministic key per user: resumes/sandesh.sitoula6-gmail.com/resume-{id}.pdf
   * @ replaced with - so the key is URL-safe
   */
  buildResumeKey(email: string, resumeId: string, ext: string): string {
    const sanitized = email.replace('@', '-')
    return `${this.prefix}/${sanitized}/resume-${resumeId}${ext}`
  }

  /**
   * Returns a presigned PUT URL the browser can upload to directly.
   * Expires in 15 minutes by default.
   */
  async getPresignedUploadUrl(
    key: string,
    contentType: string,
    expiresIn = 900,
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    })
    return getSignedUrl(this.client, command, { expiresIn })
  }

  /**
   * Returns a presigned GET URL for downloading/viewing a file.
   * Expires in 1 hour by default.
   */
  async getPresignedDownloadUrl(key: string, expiresIn = 3600): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key })
    return getSignedUrl(this.client, command, { expiresIn })
  }

  async uploadFile(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    )
    this.logger.log(`Uploaded file to S3: ${key}`)
  }

  async getObject(key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    )
    const stream = response.Body as Readable
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      stream.on('data', (chunk: Buffer) => chunks.push(chunk))
      stream.on('end', () => resolve(Buffer.concat(chunks)))
      stream.on('error', reject)
    })
  }

  async deleteFile(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    )
    this.logger.log(`Deleted file from S3: ${key}`)
  }
}
