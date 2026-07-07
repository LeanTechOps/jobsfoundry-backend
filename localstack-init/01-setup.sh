#!/bin/bash
set -e

echo "=== LocalStack init: creating S3 bucket and CORS ==="

awslocal s3 mb s3://jobblitz-dev --region us-east-1

awslocal s3api put-bucket-cors --bucket jobblitz-dev --cors-configuration '{
  "CORSRules": [
    {
      "AllowedOrigins": ["*"],
      "AllowedHeaders": ["*"],
      "AllowedMethods": ["GET", "PUT", "POST", "DELETE", "HEAD"],
      "ExposeHeaders": ["ETag"],
      "MaxAgeSeconds": 3000
    }
  ]
}'

echo "=== LocalStack init done: bucket jobblitz-dev ready ==="
