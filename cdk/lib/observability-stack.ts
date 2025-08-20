import * as cdk from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as aps from 'aws-cdk-lib/aws-aps'
import * as grafana from 'aws-cdk-lib/aws-grafana'
import * as opensearch from 'aws-cdk-lib/aws-opensearchservice'
import * as fs from 'fs'
import * as path from 'path'
import { Construct } from 'constructs'
import { StackConfig, ExportNames, CrossStackUtils } from './stack-config'

/**
 * ObservabilityStack manages monitoring, logging, and observability infrastructure
 */
export class ObservabilityStack extends cdk.Stack {
  public readonly prometheusWorkspace: aps.CfnWorkspace
  public readonly grafanaWorkspace: grafana.CfnWorkspace
  public readonly opensearchDomain: opensearch.Domain

  constructor (
    scope: Construct,
    id: string,
    config: StackConfig,
    props?: cdk.StackProps
  ) {
    super(scope, id, props)

    // Import EKS resources from InfrastructureStack for IRSA configuration
    const oidcProviderArn = CrossStackUtils.importValue(
      ExportNames.INFRA_OIDC_PROVIDER_ARN
    )
    const oidcProviderIssuer = CrossStackUtils.importValue(
      ExportNames.INFRA_OIDC_PROVIDER_ISSUER
    )

    // Import EKS cluster name for the collector
    const clusterName = CrossStackUtils.importValue(
      ExportNames.INFRA_CLUSTER_NAME
    )

    // Create Amazon Managed Prometheus workspace
    this.prometheusWorkspace = new aps.CfnWorkspace(
      this,
      'PrometheusWorkspace',
      {
        alias: `${config.environment}-eks-observability-workspace`,
        tags: [
          {
            key: 'Environment',
            value: config.environment
          },
          {
            key: 'Stack',
            value: 'Observability'
          },
          {
            key: 'Project',
            value: 'eks-observability'
          }
        ]
      }
    )

    // Load scrape configuration from file
    // const scrapeConfigPath = path.resolve(__dirname, '../scraper/eks-scraper.yaml')
    // const scrapeConfig = fs.readFileSync(scrapeConfigPath, 'utf8')

    // Create managed Prometheus collector for EKS cluster
    // new aps.CfnScraper(this, 'EksPrometheusCollector', {
    //   alias: `${config.environment}-eks-collector`,
    //   scrapeConfiguration: {
    //     configurationBlob: cdk.Fn.base64(scrapeConfig)
    //   },
    //   source: {
    //     eksConfiguration: {
    //       clusterArn: `arn:aws:eks:${this.region}:${this.account}:cluster/${clusterName}`,
    //       subnetIds: CrossStackUtils.importListValue(ExportNames.NETWORK_PRIVATE_SUBNET_IDS),
    //     }
    //   },

    //   destination: {
    //     ampConfiguration: {
    //       workspaceArn: this.prometheusWorkspace.attrArn
    //     }
    //   }
    // })

    // Create IAM role for Grafana to access Prometheus and CloudWatch
    const grafanaRole = new iam.Role(this, 'GrafanaServiceRole', {
      roleName: `${config.environment}-grafana-service-role`,
      assumedBy: new iam.ServicePrincipal('grafana.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AmazonGrafanaCloudWatchAccess'
        )
      ],
      inlinePolicies: {
        PrometheusAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'aps:ListWorkspaces',
                'aps:DescribeWorkspace',
                'aps:QueryMetrics',
                'aps:GetLabels',
                'aps:GetSeries',
                'aps:GetMetricMetadata'
              ],
              resources: ['*']
            })
          ]
        })
      }
    })

    // Create Amazon Managed Grafana workspace
    this.grafanaWorkspace = new grafana.CfnWorkspace(this, 'GrafanaWorkspace', {
      accountAccessType: 'CURRENT_ACCOUNT',
      authenticationProviders: ['AWS_SSO'],
      permissionType: 'SERVICE_MANAGED',
      name: `${config.environment}-eks-observability-grafana`,
      description: `Grafana workspace for EKS observability in ${config.environment}`,
      dataSources: ['PROMETHEUS', 'CLOUDWATCH'],
      roleArn: grafanaRole.roleArn,
      grafanaVersion: '10.4'
    })

    // Create IAM role for EKS service account to write to Prometheus
    // Use CfnJson to handle cross-stack token resolution in trust policy
    const trustPolicyDocument = new cdk.CfnJson(this, 'TrustPolicyDocument', {
      value: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: {
              Federated: oidcProviderArn
            },
            Action: 'sts:AssumeRoleWithWebIdentity',
            Condition: {
              StringEquals: {
                [`${oidcProviderIssuer}:sub`]:
                  'system:serviceaccount:prometheus:amp-iamproxy-ingest-service-account',
                [`${oidcProviderIssuer}:aud`]: 'sts.amazonaws.com'
              }
            }
          }
        ]
      }
    })

    const prometheusServiceAccountRole = new iam.CfnRole(
      this,
      'PrometheusServiceAccountRole',
      {
        roleName: `${config.environment}-prometheus-service-account-role`,
        assumeRolePolicyDocument: trustPolicyDocument,
        policies: [
          {
            policyName: 'PrometheusRemoteWrite',
            policyDocument: {
              Version: '2012-10-17',
              Statement: [
                {
                  Effect: 'Allow',
                  Action: [
                    'aps:RemoteWrite',
                    'aps:GetSeries',
                    'aps:GetLabels',
                    'aps:GetMetricMetadata'
                  ],
                  Resource: this.prometheusWorkspace.attrArn
                }
              ]
            }
          }
        ]
      }
    )

    // Create OpenSearch domain for log aggregation (deployed outside VPC for simplicity)
    this.opensearchDomain = new opensearch.Domain(this, 'OpenSearchCluster', {
      // Let CDK generate a unique domain name to avoid conflicts
      version: opensearch.EngineVersion.OPENSEARCH_2_11,
      capacity: {
        dataNodes: 1, // Single node for cost optimization
        dataNodeInstanceType:
          config.environment === 'prod' ? 'r5.large.search' : 't3.small.search',
        masterNodes: 0, // No dedicated master nodes for cost optimization
        multiAzWithStandbyEnabled: false // Disable Multi-AZ with standby for T3 compatibility
      },
      ebs: {
        volumeSize: config.environment === 'prod' ? 50 : 20,
        volumeType: ec2.EbsDeviceVolumeType.GP3
      },
      zoneAwareness: {
        enabled: false
      },
      logging: {
        slowSearchLogEnabled: true,
        appLogEnabled: true,
        slowIndexLogEnabled: true
      },
      nodeToNodeEncryption: true,
      encryptionAtRest: {
        enabled: true
      },
      enforceHttps: true,
      accessPolicies: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          principals: [new iam.AccountRootPrincipal()],
          actions: [
            'es:ESHttpGet',
            'es:ESHttpPost',
            'es:ESHttpPut',
            'es:ESHttpDelete',
            'es:ESHttpHead'
          ],
          resources: ['*']
        })
      ]
    })

    // Add tags to all resources
    cdk.Tags.of(this.prometheusWorkspace).add('Environment', config.environment)
    cdk.Tags.of(this.grafanaWorkspace).add('Environment', config.environment)
    cdk.Tags.of(this.opensearchDomain).add('Environment', config.environment)

    // Export observability service information
    CrossStackUtils.createExport(
      this,
      'PrometheusWorkspaceIdExport',
      this.prometheusWorkspace.attrWorkspaceId,
      ExportNames.OBS_PROMETHEUS_WORKSPACE_ID,
      'Amazon Managed Prometheus Workspace ID'
    )

    CrossStackUtils.createExport(
      this,
      'PrometheusEndpointExport',
      this.prometheusWorkspace.attrPrometheusEndpoint,
      ExportNames.OBS_PROMETHEUS_ENDPOINT,
      'Amazon Managed Prometheus Endpoint'
    )

    CrossStackUtils.createExport(
      this,
      'GrafanaWorkspaceIdExport',
      this.grafanaWorkspace.attrId,
      ExportNames.OBS_GRAFANA_WORKSPACE_ID,
      'Amazon Managed Grafana Workspace ID'
    )

    CrossStackUtils.createExport(
      this,
      'GrafanaEndpointExport',
      this.grafanaWorkspace.attrEndpoint,
      ExportNames.OBS_GRAFANA_ENDPOINT,
      'Amazon Managed Grafana Endpoint'
    )

    CrossStackUtils.createExport(
      this,
      'OpenSearchEndpointExport',
      this.opensearchDomain.domainEndpoint,
      ExportNames.OBS_OPENSEARCH_ENDPOINT,
      'OpenSearch Domain Endpoint'
    )

    // Additional outputs for debugging and reference
    new cdk.CfnOutput(this, 'PrometheusWorkspaceId', {
      value: this.prometheusWorkspace.attrWorkspaceId,
      description: 'Amazon Managed Prometheus Workspace ID'
    })

    new cdk.CfnOutput(this, 'PrometheusEndpoint', {
      value: this.prometheusWorkspace.attrPrometheusEndpoint,
      description: 'Amazon Managed Prometheus Endpoint'
    })

    new cdk.CfnOutput(this, 'GrafanaWorkspaceId', {
      value: this.grafanaWorkspace.attrId,
      description: 'Amazon Managed Grafana Workspace ID'
    })

    new cdk.CfnOutput(this, 'GrafanaEndpoint', {
      value: this.grafanaWorkspace.attrEndpoint,
      description: 'Amazon Managed Grafana Endpoint'
    })

    new cdk.CfnOutput(this, 'OpenSearchEndpoint', {
      value: this.opensearchDomain.domainEndpoint,
      description: 'OpenSearch Domain Endpoint'
    })

    new cdk.CfnOutput(this, 'PrometheusServiceAccountRoleArn', {
      value: prometheusServiceAccountRole.attrArn,
      description: 'IAM Role ARN for Prometheus service account'
    })

    new cdk.CfnOutput(this, 'GrafanaRoleArn', {
      value: grafanaRole.roleArn,
      description: 'IAM Role ARN for Grafana service'
    })
  }
}
