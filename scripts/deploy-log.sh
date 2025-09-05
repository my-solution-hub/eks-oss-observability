#!/bin/bash

ENVIRONMENT=${1:-dev}
REGION=$(aws configure get region)
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# Get OpenSearch endpoint from CloudFormation
OPENSEARCH_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name ${ENVIRONMENT}-observability-stack \
  --query 'Stacks[0].Outputs[?OutputKey==`OpenSearchEndpointExport`].OutputValue' \
  --output text \
  --no-cli-pager)

# Get FluentBit role ARN from CloudFormation
FLUENT_BIT_ROLE_ARN=$(aws cloudformation describe-stacks \
  --stack-name ${ENVIRONMENT}-infrastructure-stack \
  --query 'Stacks[0].Outputs[?OutputKey==`FluentBitRoleArn`].OutputValue' \
  --output text \
  --no-cli-pager)

# Get logs pipeline ingestion URL from CloudFormation
LOGS_INGESTION_URL=$(aws cloudformation describe-stacks \
  --stack-name ${ENVIRONMENT}-observability-stack \
  --query 'Stacks[0].Outputs[?OutputKey==`LogsIngestionUrl`].OutputValue' \
  --output text \
  --no-cli-pager)

# Extract host from URL (remove https:// and path)
LOGS_PIPELINE_HOST=$(echo $LOGS_INGESTION_URL | sed 's|https://||' | cut -d'/' -f1)

# Get FluentBit ingestion role ARN from CloudFormation
FLUENT_BIT_INGESTION_ROLE_ARN=$(aws cloudformation describe-stacks \
  --stack-name ${ENVIRONMENT}-infrastructure-stack \
  --query 'Stacks[0].Outputs[?OutputKey==`FluentBitIngestionRoleArn`].OutputValue' \
  --output text \
  --no-cli-pager)

# Export variables for envsubst
export AWS_REGION=$REGION
export OPENSEARCH_ENDPOINT=$OPENSEARCH_ENDPOINT
export LOGS_INGESTION_URL=$LOGS_PIPELINE_HOST
export FLUENT_BIT_ROLE_ARN=$FLUENT_BIT_ROLE_ARN
export FLUENT_BIT_INGESTION_ROLE_ARN=$FLUENT_BIT_INGESTION_ROLE_ARN

echo "Using AWS_REGION: $AWS_REGION"
echo "Using LOGS_PIPELINE_HOST: $LOGS_PIPELINE_HOST"
echo "Using FLUENT_BIT_ROLE_ARN: $FLUENT_BIT_ROLE_ARN"
echo "Using FLUENT_BIT_INGESTION_ROLE_ARN: $FLUENT_BIT_INGESTION_ROLE_ARN"

# Deploy FluentBit with environment variable substitution
envsubst < k8s-res/log/fluentbit.yaml | kubectl apply -f -

echo "FluentBit deployment completed. Check status with:"
echo "kubectl get pods -n kube-system -l k8s-app=fluent-bit-logging"
kubectl rollout restart daemonset fluent-bit -n kube-system
