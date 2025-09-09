helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

# Install kube-state-metrics
helm install kube-state-metrics prometheus-community/kube-state-metrics \
  --namespace kube-state-metrics \
  --create-namespace \
  --set extraArgs[0]="--metric-labels-allowlist=pods=[*]"