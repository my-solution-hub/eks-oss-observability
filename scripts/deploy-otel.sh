#!/bin/bash

ENVIRONMENT=${1:-dev}
REGION=$(aws configure get region)

# Get Prometheus remote write endpoint
PROMETHEUS_REMOTE_WRITE_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name ${ENVIRONMENT}-observability-stack \
  --query 'Stacks[0].Outputs[?OutputKey==`PrometheusEndpoint`].OutputValue' \
  --output text \
  --no-cli-pager)

# Get OpenSearch endpoint
TRACE_PIPELINE_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name ${ENVIRONMENT}-observability-stack \
  --query 'Stacks[0].Outputs[?OutputKey==`TracesIngestionUrl`].OutputValue' \
  --output text \
  --no-cli-pager)

OPENSEARCH_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name ${ENVIRONMENT}-observability-stack \
  --query 'Stacks[0].Outputs[?OutputKey==`OpenSearchEndpointExport`].OutputValue' \
  --output text \
  --no-cli-pager)

# Get OTEL collector role ARN
OTEL_COLLECTOR_ROLE_ARN=$(aws cloudformation describe-stacks \
  --stack-name ${ENVIRONMENT}-observability-stack \
  --query 'Stacks[0].Outputs[?OutputKey==`OtelCollectorRoleArn`].OutputValue' \
  --output text \
  --no-cli-pager)

# Export variables for envsubst
export AWS_REGION=$REGION
export PROMETHEUS_REMOTE_WRITE_ENDPOINT="${PROMETHEUS_REMOTE_WRITE_ENDPOINT}api/v1/remote_write"
export TRACE_PIPELINE_ENDPOINT=$TRACE_PIPELINE_ENDPOINT
export OTEL_COLLECTOR_ROLE_ARN=$OTEL_COLLECTOR_ROLE_ARN
export OPENSEARCH_ENDPOINT=$OPENSEARCH_ENDPOINT
export OTEL_COLLECTOR_IMAGE="public.ecr.aws/aws-observability/aws-otel-collector:latest"

echo "Using AWS_REGION: $AWS_REGION"
echo "Using PROMETHEUS_REMOTE_WRITE_ENDPOINT: $PROMETHEUS_REMOTE_WRITE_ENDPOINT"
echo "Using TRACE_PIPELINE_ENDPOINT: $TRACE_PIPELINE_ENDPOINT"
echo "Using OPENSEARCH_ENDPOINT: $OPENSEARCH_ENDPOINT"
echo "Using OTEL_COLLECTOR_ROLE_ARN: $OTEL_COLLECTOR_ROLE_ARN"

# Deploy OTEL collector
envsubst < k8s-res/otel/otel-collector.yaml | kubectl apply -f -

kubectl rollout restart deployment/otel-collector
echo "OTEL collector deployment completed. Check status with:"
echo "kubectl get pods -l app=otel-collector"
