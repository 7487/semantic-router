//go:build windows

package evaluationplane

import "fmt"

type evaluationStoreOwnership struct{}

// Windows does not have the Unix flock contract used to protect this durable
// filesystem store. Refuse to start instead of allowing two processes to
// publish conflicting evaluation evidence.
func acquireEvaluationStoreOwnership(string) (*evaluationStoreOwnership, error) {
	return nil, fmt.Errorf("%w: evaluation store ownership locking is unsupported on Windows", ErrConflict)
}

func (o *evaluationStoreOwnership) release() error { return nil }
