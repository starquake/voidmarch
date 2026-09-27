package server

var (
	RecoverPanic  = recoverPanic
	RequestLogger = requestLogger
	LogRequests   = logRequests
	NewStatic     = newStaticFiles
	HandleStatic  = handleStatic
	ErrIsDir      = errIsDir
)

// NoDirFS exposes noDirFS for tests.
type NoDirFS = noDirFS
