import * as cdk from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as eks from 'aws-cdk-lib/aws-eks'
import * as iam from 'aws-cdk-lib/aws-iam'
import { Construct } from 'constructs'
import { KubectlV31Layer } from '@aws-cdk/lambda-layer-kubectl-v31'
import { StackConfig, ExportNames, CrossStackUtils } from './stack-config'

/**
 * InfrastructureStack manages EKS cluster and compute infrastructure
 */
export class InfrastructureStack extends cdk.Stack {
  public readonly cluster: eks.Cluster

  constructor (
    scope: Construct,
    id: string,
    config: StackConfig,
    props?: cdk.StackProps
  ) {
    super(scope, id, props)

    // Import VPC resources from NetworkStack
    const vpcId = CrossStackUtils.importValue(ExportNames.NETWORK_VPC_ID)
    const privateSubnetIds = CrossStackUtils.importListValue(
      ExportNames.NETWORK_PRIVATE_SUBNET_IDS
    )

    // Create VPC reference from imported values
    const vpc = ec2.Vpc.fromVpcAttributes(this, 'ImportedVpc', {
      vpcId,
      availabilityZones: cdk.Fn.getAzs(),
      privateSubnetIds
    })

    // Determine Kubernetes version
    const kubernetesVersion =
      config.eksVersion === '1.31'
        ? eks.KubernetesVersion.V1_31
        : eks.KubernetesVersion.V1_29

    // Create EKS Cluster
    this.cluster = new eks.Cluster(this, 'EksCluster', {
      version: kubernetesVersion,
      clusterName: `${config.environment}-eks-cluster`,
      authenticationMode: eks.AuthenticationMode.API_AND_CONFIG_MAP,
      vpc: vpc,
      vpcSubnets: [
        {
          subnets: vpc.privateSubnets
        }
      ],
      defaultCapacity: 0, // We'll add our own node group
      kubectlLayer: new KubectlV31Layer(this, 'KubectlLayer'),
      endpointAccess:
        eks.EndpointAccess.PUBLIC_AND_PRIVATE.onlyFrom('0.0.0.0/0'),
      clusterLogging: [
        eks.ClusterLoggingTypes.API,
        eks.ClusterLoggingTypes.AUTHENTICATOR,
        eks.ClusterLoggingTypes.SCHEDULER,
        eks.ClusterLoggingTypes.CONTROLLER_MANAGER
      ]
    })

    // Create access entries for EKS cluster
    new eks.AccessEntry(this, 'AdminRoleAccess', {
      cluster: this.cluster,
      principal: `arn:aws:iam::${this.account}:role/Admin`,
      accessPolicies: [eks.AccessPolicy.fromAccessPolicyName('AmazonEKSClusterAdminPolicy', {
        accessScopeType: eks.AccessScopeType.CLUSTER
      })]
    })

    new eks.AccessEntry(this, 'YagrxuUserAccess', {
      cluster: this.cluster,
      principal: `arn:aws:iam::${this.account}:user/yagrxu`,
      accessPolicies: [eks.AccessPolicy.fromAccessPolicyName('AmazonEKSClusterAdminPolicy', {
        accessScopeType: eks.AccessScopeType.CLUSTER
      })]
    })

    // Add EBS CSI driver addon for volume metrics
    new eks.CfnAddon(this, 'EbsCsiDriverAddon', {
      clusterName: this.cluster.clusterName,
      addonName: 'aws-ebs-csi-driver'
    })

    // Add kube-state-metrics addon for comprehensive metrics including PV metrics
    new eks.CfnAddon(this, 'KubeStateMetricsAddon', {
      clusterName: this.cluster.clusterName,
      addonName: 'kube-state-metrics',
      addonVersion: 'v2.16.0-eksbuild.1'
    })

    // Add managed node group
    const nodeGroup = this.cluster.addNodegroupCapacity('DefaultNodeGroup', {
      instanceTypes: [
        new ec2.InstanceType(config.nodeInstanceType || 't3.large')
      ],
      minSize: config.nodeCount || 3,
      maxSize: (config.nodeCount || 3) + 2,
      desiredSize: config.nodeCount || 3,
      subnets: {
        subnets: vpc.privateSubnets
      },
      amiType: eks.NodegroupAmiType.AL2_X86_64,
      capacityType: eks.CapacityType.ON_DEMAND,
      diskSize: 20,
      nodegroupName: `${config.environment}-eks-nodes`
    })

    // Add EBS CSI policy to node group role
    nodeGroup.role.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonEBSCSIDriverPolicy')
    )

    // Add tags to cluster and node group
    cdk.Tags.of(this.cluster).add('Environment', config.environment)
    cdk.Tags.of(this.cluster).add('Stack', 'Infrastructure')
    cdk.Tags.of(nodeGroup).add('Environment', config.environment)

    // Export cluster information for other stacks
    CrossStackUtils.createExport(
      this,
      'ClusterNameExport',
      this.cluster.clusterName,
      ExportNames.INFRA_CLUSTER_NAME,
      'EKS cluster name for cross-stack reference'
    )

    CrossStackUtils.createExport(
      this,
      'ClusterArnExport',
      this.cluster.clusterArn,
      ExportNames.INFRA_CLUSTER_ARN,
      'EKS cluster ARN for cross-stack reference'
    )

    CrossStackUtils.createExport(
      this,
      'OidcProviderArnExport',
      this.cluster.openIdConnectProvider.openIdConnectProviderArn,
      ExportNames.INFRA_OIDC_PROVIDER_ARN,
      'EKS OIDC provider ARN for IRSA'
    )

    CrossStackUtils.createExport(
      this,
      'OidcProviderIssuerExport',
      this.cluster.openIdConnectProvider.openIdConnectProviderIssuer,
      ExportNames.INFRA_OIDC_PROVIDER_ISSUER,
      'EKS OIDC provider issuer URL for IRSA'
    )

    // Additional outputs for debugging and reference
    new cdk.CfnOutput(this, 'ClusterName', {
      value: this.cluster.clusterName,
      description: 'EKS Cluster Name'
    })

    new cdk.CfnOutput(this, 'ClusterEndpoint', {
      value: this.cluster.clusterEndpoint,
      description: 'EKS Cluster Endpoint'
    })

    new cdk.CfnOutput(this, 'ClusterSecurityGroupId', {
      value: this.cluster.clusterSecurityGroupId,
      description: 'EKS Cluster Security Group ID'
    })

    new cdk.CfnOutput(this, 'KubectlRoleArn', {
      value: this.cluster.kubectlRole?.roleArn || 'N/A',
      description: 'Kubectl execution role ARN'
    })

    new cdk.CfnOutput(this, 'NodeGroupName', {
      value: nodeGroup.nodegroupName,
      description: 'EKS Node Group Name'
    })
  }
}
