package server

var (
	RecoverPanic  = recoverPanic
	RequestLogger = requestLogger
	LogRequests   = logRequests
	NewStatic     = newStaticFiles
	HandleIndex   = handleIndex
	HandleStatic  = handleStatic
	HandleBuild   = handleBuild
	BuildID       = buildID
	ErrIsDir      = errIsDir
	AcceptsGzip   = acceptsGzip
)

// NoDirFS exposes noDirFS for tests.
type NoDirFS = noDirFS
