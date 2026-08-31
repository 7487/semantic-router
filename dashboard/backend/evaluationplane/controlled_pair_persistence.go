package evaluationplane

import (
	"fmt"
	"os"
)

// controlledPairPersistence is the narrow durability seam for aggregate
// directory publication. In particular, a newly-created pair directory is not
// eligible to reference published members until its parent directory sync has
// completed successfully.
type controlledPairPersistence interface {
	EnsurePrivateDirectory(path string) (bool, error)
	SyncDirectory(path, description string) error
	WriteManifest(path string, pair controlledPairManifest) error
	Rename(source, destination string) error
}

type atomicControlledPairPersistence struct{}

func (atomicControlledPairPersistence) EnsurePrivateDirectory(path string) (bool, error) {
	if err := os.Mkdir(path, 0o700); err == nil {
		return true, nil
	} else if !os.IsExist(err) {
		return false, fmt.Errorf("create controlled pair directory: %w", err)
	}
	if err := requirePrivateDirectory(path); err != nil {
		return false, err
	}
	return false, nil
}

func (atomicControlledPairPersistence) SyncDirectory(path, description string) error {
	return syncEvaluationDirectory(path, description)
}

func (atomicControlledPairPersistence) WriteManifest(path string, pair controlledPairManifest) error {
	return writeJSONAtomic(path, pair)
}

func (atomicControlledPairPersistence) Rename(source, destination string) error {
	return os.Rename(source, destination)
}
