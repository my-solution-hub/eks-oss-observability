#!/bin/bash

APP_NAME=$1
BUILD_PUSH=${2:-true}
REGION=$(aws configure get region)
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# Get EKS cluster name from CDK stack
CLUSTER_NAME=$(aws cloudformation describe-stacks \
  --stack-name dev-infrastructure-stack \
  --query 'Stacks[0].Outputs[?OutputKey==`ClusterName`].OutputValue' \
  --output text \
  --no-cli-pager)

# Export variables for envsubst
export ACCOUNT_ID REGION CLUSTER_NAME

echo "Using ACCOUNT_ID: $ACCOUNT_ID"
echo "Using REGION: $REGION"
echo "Using CLUSTER_NAME: $CLUSTER_NAME"

deploy_app() {
    local app=$1
    
    echo "Deploying $app..."
    
    # Substitute environment variables in YAML and deploy
    envsubst < k8s-res/app/$app.yaml | kubectl apply -f -

    # rollout deployment
    kubectl rollout restart deployment/$app
}

# Build and push if requested
if [ "$BUILD_PUSH" = "true" ]; then
    echo "Building and pushing applications..."
    ./scripts/build-push.sh
fi

if [ -z "$APP_NAME" ]; then
    echo "Deploying all apps..."
    deploy_app "world-service"
    deploy_app "hello-service"
    deploy_app "traffic-generator"
else
    deploy_app "$APP_NAME"
fi

echo "Deployment completed. Check status with:"
echo "kubectl get pods"
