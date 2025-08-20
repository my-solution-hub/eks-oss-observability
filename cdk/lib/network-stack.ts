import * as cdk from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import { Construct } from 'constructs'
import { StackConfig, ExportNames, CrossStackUtils } from './stack-config'

/**
 * NetworkStack manages all networking infrastructure including VPC, subnets, and connectivity components
 */
export class NetworkStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc

  constructor (
    scope: Construct,
    id: string,
    config: StackConfig,
    props?: cdk.StackProps
  ) {
    super(scope, id, props)

    // Create VPC with public and private subnets across 3 AZs
    this.vpc = new ec2.Vpc(this, 'EksVpc', {
      maxAzs: 3,
      natGateways: 1,
      vpcName: `${config.environment}-eks-vpc`,
      ipAddresses: config.vpcCidr
        ? ec2.IpAddresses.cidr(config.vpcCidr)
        : ec2.IpAddresses.cidr('10.0.0.0/16'),
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
          mapPublicIpOnLaunch: false
        },
        {
          cidrMask: 24,
          name: 'private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
        }
      ],
      enableDnsHostnames: true,
      enableDnsSupport: true
    })

    // Add tags to VPC and subnets for better organization
    cdk.Tags.of(this.vpc).add('Environment', config.environment)
    cdk.Tags.of(this.vpc).add('Stack', 'Network')

    // Tag subnets for EKS discovery
    this.vpc.privateSubnets.forEach((subnet, index) => {
      cdk.Tags.of(subnet).add('kubernetes.io/role/internal-elb', '1')
      cdk.Tags.of(subnet).add(
        'Name',
        `${config.environment}-private-subnet-${index + 1}`
      )
    })

    this.vpc.publicSubnets.forEach((subnet, index) => {
      cdk.Tags.of(subnet).add('kubernetes.io/role/elb', '1')
      cdk.Tags.of(subnet).add(
        'Name',
        `${config.environment}-public-subnet-${index + 1}`
      )
    })

    // Export VPC ID for other stacks
    CrossStackUtils.createExport(
      this,
      'VpcIdExport',
      this.vpc.vpcId,
      ExportNames.NETWORK_VPC_ID,
      'VPC ID for cross-stack reference'
    )

    // Export private subnet IDs as comma-separated string
    CrossStackUtils.createExport(
      this,
      'PrivateSubnetIdsExport',
      this.vpc.privateSubnets.map(subnet => subnet.subnetId).join(','),
      ExportNames.NETWORK_PRIVATE_SUBNET_IDS,
      'Private subnet IDs for cross-stack reference'
    )

    // Export public subnet IDs as comma-separated string
    CrossStackUtils.createExport(
      this,
      'PublicSubnetIdsExport',
      this.vpc.publicSubnets.map(subnet => subnet.subnetId).join(','),
      ExportNames.NETWORK_PUBLIC_SUBNET_IDS,
      'Public subnet IDs for cross-stack reference'
    )

    // Export VPC CIDR block for security group rules
    CrossStackUtils.createExport(
      this,
      'VpcCidrExport',
      this.vpc.vpcCidrBlock,
      ExportNames.NETWORK_VPC_CIDR,
      'VPC CIDR block for security group rules'
    )

    // Additional outputs for debugging and reference
    new cdk.CfnOutput(this, 'VpcId', {
      value: this.vpc.vpcId,
      description: 'VPC ID'
    })

    new cdk.CfnOutput(this, 'AvailabilityZones', {
      value: this.vpc.availabilityZones.join(', '),
      description: 'Availability Zones used by the VPC'
    })

    new cdk.CfnOutput(this, 'PrivateSubnetCount', {
      value: this.vpc.privateSubnets.length.toString(),
      description: 'Number of private subnets created'
    })

    new cdk.CfnOutput(this, 'PublicSubnetCount', {
      value: this.vpc.publicSubnets.length.toString(),
      description: 'Number of public subnets created'
    })
  }
}
