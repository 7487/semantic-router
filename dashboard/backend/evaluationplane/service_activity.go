package evaluationplane

import "context"

// The lifecycle coordinator is already shared by every Service using one
// durable root. A separate mutex keeps worker cleanup from inverting the
// lifecycle lock order while avoiding another per-root registry.
func (c *lifecycleCoordinator) claim(runIDs []string, cancellations []context.CancelFunc) bool {
	if len(runIDs) == 0 || len(runIDs) != len(cancellations) {
		return false
	}
	for _, cancel := range cancellations {
		if cancel == nil {
			return false
		}
	}
	seen := make(map[string]bool, len(runIDs))
	for _, runID := range runIDs {
		if runID == "" || seen[runID] {
			return false
		}
		seen[runID] = true
	}
	c.activityMu.Lock()
	defer c.activityMu.Unlock()
	for _, runID := range runIDs {
		if c.activeRuns[runID] != nil {
			return false
		}
	}
	for index, runID := range runIDs {
		c.activeRuns[runID] = cancellations[index]
	}
	return true
}

func (c *lifecycleCoordinator) release(runID string) {
	c.activityMu.Lock()
	defer c.activityMu.Unlock()
	delete(c.activeRuns, runID)
}

func (c *lifecycleCoordinator) contains(runID string) bool {
	c.activityMu.Lock()
	defer c.activityMu.Unlock()
	return c.activeRuns[runID] != nil
}

// requestCancel copies owner callbacks under the activity mutex and invokes
// them only after unlocking. The worker owner remains responsible for release,
// so remote cancellation cannot make deletion visible before process exit.
func (c *lifecycleCoordinator) requestCancel(runIDs ...string) int {
	c.activityMu.Lock()
	cancellations := make([]context.CancelFunc, 0, len(runIDs))
	for _, runID := range runIDs {
		if cancel := c.activeRuns[runID]; cancel != nil {
			cancellations = append(cancellations, cancel)
		}
	}
	c.activityMu.Unlock()
	for _, cancel := range cancellations {
		cancel()
	}
	return len(cancellations)
}
