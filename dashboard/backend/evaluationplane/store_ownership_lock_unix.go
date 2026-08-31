//go:build !windows

package evaluationplane

import (
	"errors"
	"fmt"
	"path/filepath"
	"sync"

	"golang.org/x/sys/unix"
)

const evaluationStoreOwnershipLockName = ".evaluation-store.lock"

// evaluationStoreOwnership keeps the advisory lock open for every Service in
// this process using one canonical store root. flock is released by the kernel
// on process exit, so a crash cannot leave a stale ownership marker behind.
type evaluationStoreOwnership struct {
	root string
	fd   int
	refs int
}

var evaluationStoreOwnerships = struct {
	sync.Mutex
	byRoot map[string]*evaluationStoreOwnership
}{byRoot: make(map[string]*evaluationStoreOwnership)}

func acquireEvaluationStoreOwnership(root string) (*evaluationStoreOwnership, error) {
	evaluationStoreOwnerships.Lock()
	defer evaluationStoreOwnerships.Unlock()
	if owned := evaluationStoreOwnerships.byRoot[root]; owned != nil {
		owned.refs++
		return owned, nil
	}
	fd, err := openEvaluationStoreOwnershipLock(root)
	if err != nil {
		return nil, err
	}
	owned := &evaluationStoreOwnership{root: root, fd: fd, refs: 1}
	evaluationStoreOwnerships.byRoot[root] = owned
	return owned, nil
}

func (o *evaluationStoreOwnership) release() error {
	if o == nil {
		return nil
	}
	evaluationStoreOwnerships.Lock()
	defer evaluationStoreOwnerships.Unlock()
	current := evaluationStoreOwnerships.byRoot[o.root]
	if current != o || o.refs <= 0 {
		return fmt.Errorf("evaluation store ownership is invalid")
	}
	o.refs--
	if o.refs != 0 {
		return nil
	}
	delete(evaluationStoreOwnerships.byRoot, o.root)
	unlockErr := unix.Flock(o.fd, unix.LOCK_UN)
	closeErr := unix.Close(o.fd)
	return errors.Join(unlockErr, closeErr)
}

func openEvaluationStoreOwnershipLock(root string) (int, error) {
	if err := requirePrivateDirectory(root); err != nil {
		return -1, fmt.Errorf("validate evaluation store root: %w", err)
	}
	directoryFD, err := unix.Open(filepath.Clean(root), unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return -1, fmt.Errorf("open evaluation store root: %w", err)
	}
	defer func() { _ = unix.Close(directoryFD) }()
	fd, err := unix.Openat(
		directoryFD, evaluationStoreOwnershipLockName,
		unix.O_RDWR|unix.O_CREAT|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0o600,
	)
	if err != nil {
		return -1, fmt.Errorf("open evaluation store ownership lock: %w", err)
	}
	cleanup := func() { _ = unix.Close(fd) }
	var stat unix.Stat_t
	if err := unix.Fstat(fd, &stat); err != nil {
		cleanup()
		return -1, fmt.Errorf("stat evaluation store ownership lock: %w", err)
	}
	if stat.Mode&unix.S_IFMT != unix.S_IFREG || stat.Nlink != 1 || stat.Mode&0o777 != 0o600 {
		cleanup()
		return -1, fmt.Errorf("evaluation store ownership lock is not a private regular file")
	}
	if err := unix.Flock(fd, unix.LOCK_EX|unix.LOCK_NB); err != nil {
		cleanup()
		if errors.Is(err, unix.EWOULDBLOCK) || errors.Is(err, unix.EAGAIN) {
			return -1, fmt.Errorf("%w: evaluation data directory is owned by another process", ErrConflict)
		}
		return -1, fmt.Errorf("lock evaluation data directory: %w", err)
	}
	return fd, nil
}
