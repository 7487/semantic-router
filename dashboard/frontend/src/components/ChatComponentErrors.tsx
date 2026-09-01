import styles from './ChatComponent.module.css'
import type { PlaygroundErrorPresentation } from './playgroundErrorPresentation'
import type { PlaygroundRoutingModelStatus } from './usePlaygroundRoutingModel'

interface ChatComponentErrorsProps {
  onDismissError: () => void
  onRetryRoutingModelDiscovery: () => void
  routingModelStatus: PlaygroundRoutingModelStatus
  visibleError: PlaygroundErrorPresentation | null
}

export default function ChatComponentErrors({
  onDismissError,
  onRetryRoutingModelDiscovery,
  routingModelStatus,
  visibleError,
}: ChatComponentErrorsProps) {
  const routingModelUnavailable = routingModelStatus === 'error' && !visibleError
  if (!routingModelUnavailable && !visibleError) return null

  return (
    <div className={styles.errorRegion} data-testid="playground-error-region">
      <div className={styles.error} role="alert">
        <span className={styles.errorIcon} aria-hidden="true">
          !
        </span>
        <div className={styles.errorCopy}>
          <span className={styles.errorMessage}>
            {routingModelUnavailable
              ? 'The automatic routing model is unavailable.'
              : visibleError?.message}
          </span>
          {!routingModelUnavailable && visibleError?.technicalDetails ? (
            <details className={styles.errorDetails} data-playground-technical-details="true">
              <summary>Technical details</summary>
              <pre>{visibleError.technicalDetails}</pre>
            </details>
          ) : null}
        </div>
        {routingModelUnavailable ? (
          <button
            type="button"
            className={styles.errorAction}
            onClick={onRetryRoutingModelDiscovery}
          >
            Retry discovery
          </button>
        ) : (
          <button
            type="button"
            className={styles.errorDismiss}
            aria-label="Dismiss error"
            onClick={onDismissError}
          >
            ×
          </button>
        )}
      </div>
    </div>
  )
}
