package evaluationplane

import (
	"fmt"
	"strings"
)

type serviceRuntimeSetup struct {
	codeRevision       string
	routerAuthRequired bool
	process            Process
}

func prepareServiceRuntime(options *Options, store *Store) (serviceRuntimeSetup, error) {
	codeRevision := strings.TrimSpace(options.CodeRevision)
	if !sourceRevisionPattern.MatchString(codeRevision) {
		return serviceRuntimeSetup{}, fmt.Errorf(
			"%w: evaluation source revision must be an immutable git commit or source-tree digest",
			ErrInvalid,
		)
	}
	if options.EnvoyAPIKeyEnv != "" && !secretEnvPattern.MatchString(options.EnvoyAPIKeyEnv) {
		return serviceRuntimeSetup{}, fmt.Errorf("evaluation Envoy credential reference must be an uppercase environment variable name")
	}
	routerAuthRequired, err := resolveRouterAuthentication(options.RouterAPIKeyEnv, options.CredentialProvider)
	if err != nil {
		return serviceRuntimeSetup{}, err
	}
	// CodeRevision identifies the evaluation implementation, not the model
	// servers behind a Mixture. Do not publish it as every arm's runtime
	// revision: source-only changes must not mutate the pool treatment.
	snapshot, err := LoadModelArmSnapshot(options.ConfigPath, "")
	if err != nil {
		return serviceRuntimeSetup{}, err
	}
	installedSuites, err := loadInstalledCatalogSuites(store.SuiteRoot())
	if err != nil {
		return serviceRuntimeSetup{}, err
	}
	deploymentTargets, err := LoadEvaluationDeploymentRegistry(options.DeploymentsDir, "")
	if err != nil {
		return serviceRuntimeSetup{}, err
	}
	mixtures := snapshot.Mixtures
	if len(deploymentTargets) > 0 {
		mixtures = nil
	}
	_, err = NewRegistry(options.RouterAPIURL, options.EnvoyURL, RegistryOptions{
		RouterAPIKey: configuredRuntimeSecretRef(
			options.RouterAPIURL, deploymentTargets, options.RouterAPIKeyEnv, true,
		),
		EnvoyAPIKey: configuredRuntimeSecretRef(
			options.EnvoyURL, deploymentTargets, options.EnvoyAPIKeyEnv, false,
		),
		AgentTaskLedger:            copyServiceEndpoint(options.AgentTaskLedger),
		FaultRecoveryLedger:        copyServiceEndpoint(options.FaultRecoveryLedger),
		HardPolicyLedger:           copyServiceEndpoint(options.HardPolicyLedger),
		ProductionExperimentLedger: copyServiceEndpoint(options.ProductionExperimentLedger),
		Mixtures:                   mixtures,
		DeploymentTargets:          deploymentTargets,
		DefaultConfigDigest:        snapshot.ConfigDigest,
		RouterAuthRequired:         routerAuthRequired,
		InstalledSuites:            installedSuites,
	})
	if err != nil {
		return serviceRuntimeSetup{}, err
	}
	process, err := configureServiceProcess(options, store)
	if err != nil {
		return serviceRuntimeSetup{}, err
	}
	return serviceRuntimeSetup{
		codeRevision: codeRevision, routerAuthRequired: routerAuthRequired, process: process,
	}, nil
}
