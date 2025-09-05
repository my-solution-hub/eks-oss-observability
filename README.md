# EKS OSS Observability

A comprehensive observability solution for Amazon EKS using open-source tools and AWS managed services.

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   EKS Cluster   │───▶│   Prometheus     │───▶│    Grafana      │
│                 │    │   (AMP)          │    │   (AMG)         │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │
         ▼
┌─────────────────┐    ┌──────────────────┐
│   Log Streams   │───▶│   OpenSearch     │
│                 │    │   + Application  │
└─────────────────┘    └──────────────────┘
```

**Components:**
- **Amazon EKS**: Kubernetes cluster for workloads
- **Amazon Managed Prometheus (AMP)**: Metrics collection and storage
- **Amazon Managed Grafana (AMG)**: Metrics visualization and dashboards
- **Amazon OpenSearch**: Log aggregation and search
- **OpenSearch Application**: Managed dashboard interface for logs

## Prerequisites

- AWS CLI configured with appropriate permissions
- Node.js 18+ and npm
- AWS CDK v2.199.0+
- kubectl configured for EKS access

**Required AWS Permissions:**
- EKS cluster management
- VPC and networking resources
- IAM roles and policies
- OpenSearch domain management
- Prometheus and Grafana workspace creation

## Deployment Process

### 1. Install Dependencies
```bash
cd cdk
npm install
```

### 2. Deploy Infrastructure
```bash
# Deploy all stacks in order
npm run deploy

# Or deploy individually:
npx cdk deploy NetworkStack
npx cdk deploy InfrastructureStack  
npx cdk deploy ObservabilityStack
```

### 3. Configure kubectl for EKS
After infrastructure deployment, configure kubectl to access the EKS cluster:

```bash
# Get cluster name from CloudFormation output
CLUSTER_NAME=$(aws cloudformation describe-stacks \
  --stack-name dev-infrastructure-stack \
  --query 'Stacks[0].Outputs[?OutputKey==`EksClusterName`].OutputValue' \
  --output text)

# Update kubeconfig
aws eks update-kubeconfig --region <your-region> --name $CLUSTER_NAME
```

### 4. Configure OpenSearch Application VPC Access
After CDK deployment completes, run the VPC endpoint authorization script:

```bash
./scripts/authorize-vpc-endpoint.sh
```

This script:
- Extracts the OpenSearch domain name from CloudFormation
- Authorizes VPC endpoint access for OpenSearch Application dashboard
- Enables secure access to the OpenSearch dashboard through VPC endpoints

### 5. Verify Deployment
```bash
# Check stack outputs
npx cdk list
aws cloudformation describe-stacks --stack-name dev-observability-stack --query 'Stacks[0].Outputs'
```

## Configuration

The deployment creates:
- **Network Stack**: VPC, subnets, security groups
- **Infrastructure Stack**: EKS cluster with OIDC provider
- **Observability Stack**: Prometheus, Grafana, OpenSearch with Application

Environment-specific configurations are managed through the `StackConfig` in `/cdk/lib/stack-config.ts`.

## Access

- **Grafana Dashboard**: Available via AMG workspace endpoint (requires AWS SSO)
- **OpenSearch Dashboard**: Available via OpenSearch Application endpoint
- **Prometheus**: Accessible via AMP workspace for queries

## Security

- All services deployed within VPC with private subnets
- Security groups restrict access to necessary ports
- IAM roles follow least-privilege principle
- OpenSearch domain uses VPC endpoints for secure access
- HTTPS enforced for all endpoints
